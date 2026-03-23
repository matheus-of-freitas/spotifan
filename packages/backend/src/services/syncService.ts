import { getFollowedArtists, getArtistAlbums, getSpotifyUserCountry } from './spotifyClient.js';
import { getValidAccessToken } from './tokenService.js';
import {
  batchWriteUserReleases,
  batchWriteArtistReleases,
  getArtistReleasesCached,
  getUserExistingAlbumIds,
  getYearsIndex,
  putYearsIndex,
  putGenresIndex,
  putArtistsIndex,
  getArtistsIndex,
} from '../db/releases.js';
import { putSyncStatus } from '../db/sync.js';
import { getUser, putUser, updateSyncStatus } from '../db/users.js';
import type { Release, CachedArtist } from '../db/releases.js';
import type { SpotifyAlbum } from './spotifyClient.js';
import { createChildLogger, logUnknownError } from '../lib/logger.js';
import { AppError, RetryBudgetExceededError } from '../lib/errors.js';
import { sleep } from '../lib/retry.js';

const ARTIST_REQUEST_DELAY_MS = 500;
const MAX_ARTIST_REQUEST_DELAY_MS = 3000;
const DELAY_RECOVERY_MS = 100;
const RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_CONSECUTIVE_RATE_LIMITS = 3;

export interface SyncContinuation {
  artistIndex: number;
  skippedCount: number;
  startedAt: number;
  accumulatedYears: string[];
  accumulatedGenres: string[];
  currentDelay: number;
}

function albumToRelease(
  album: SpotifyAlbum,
  artistId: string,
  artistName: string,
  genres: string[],
): Release {
  const year = album.release_date.slice(0, 4);
  return {
    albumId: album.id,
    title: album.name,
    artistId,
    artistName,
    albumType: album.album_type as Release['albumType'],
    imageUrl: album.images[0]?.url ?? '',
    spotifyUrl: album.external_urls.spotify,
    releaseDate: album.release_date,
    year,
    genres,
  };
}

export async function runSync(
  spotifyId: string,
  syncType: 'quick' | 'full',
  options?: {
    resumeState?: SyncContinuation;
    deadlineMs?: number;
  },
): Promise<SyncContinuation | undefined> {
  const resumeState = options?.resumeState;
  const deadlineMs = options?.deadlineMs;
  const now = resumeState?.startedAt ?? Date.now();
  const currentYear = new Date().getFullYear().toString();
  const log = createChildLogger({ operation: 'runSync', spotifyId, syncType });
  log.info(resumeState ? 'Sync resumed' : 'Sync started');

  if (!resumeState) {
    await putSyncStatus(spotifyId, {
      status: 'running',
      syncType,
      totalArtists: 0,
      processedArtists: 0,
      startedAt: now,
      updatedAt: now,
    });
    await updateSyncStatus(spotifyId, 'running');
  }

  try {
    log.info('Fetching access token for sync');
    const accessToken = await getValidAccessToken(spotifyId);
    log.info('Fetched access token for sync');

    // Resolve user's market (country) for Spotify API calls
    const user = await getUser(spotifyId);
    let country = user?.country;
    if (!country) {
      log.info('Backfilling user country from Spotify profile');
      country = await getSpotifyUserCountry(accessToken);
      if (user) {
        await putUser({ ...user, country });
      }
    }

    log.info('Fetching followed artists');
    let artists: CachedArtist[];
    if (syncType === 'full' && !resumeState) {
      let rawArtists;
      try {
        rawArtists = await getFollowedArtists(accessToken);
      } catch (err) {
        throw new Error(`Followed artists request failed: ${getErrorMessage(err)}`);
      }
      log.info('Fetched followed artists', { artistCount: rawArtists.length });
      await putArtistsIndex(spotifyId, rawArtists);
      artists = rawArtists;
    } else {
      artists = await getArtistsIndex(spotifyId);
      log.info('Loaded artists from index', { artistCount: artists.length });
    }

    const startIndex = resumeState?.artistIndex ?? 0;

    await putSyncStatus(spotifyId, {
      status: 'running',
      syncType,
      totalArtists: artists.length,
      processedArtists: startIndex,
      startedAt: now,
      updatedAt: Date.now(),
    });

    // Load existing album IDs to skip already-persisted albums
    const existingAlbumIds = await getUserExistingAlbumIds(spotifyId);
    const seenAlbumIds = new Set<string>(existingAlbumIds);
    const allYears = new Set<string>(resumeState?.accumulatedYears ?? []);
    const allGenres = new Set<string>(resumeState?.accumulatedGenres ?? []);
    let processedCount = startIndex;
    let skippedCount = resumeState?.skippedCount ?? 0;
    let currentDelay = resumeState?.currentDelay ?? ARTIST_REQUEST_DELAY_MS;

    let consecutiveRateLimits = 0;
    for (let i = startIndex; i < artists.length; i++) {
      // Check deadline before processing each artist
      if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
        log.info('Deadline reached, returning continuation', {
          artistIndex: i,
          processedArtists: processedCount,
          totalArtists: artists.length,
        });
        return {
          artistIndex: i,
          skippedCount,
          startedAt: now,
          accumulatedYears: Array.from(allYears),
          accumulatedGenres: Array.from(allGenres),
          currentDelay,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounded by loop condition
      const artist = artists[i]!;
      log.info('Processing artist releases', {
        artistId: artist.id,
        artistName: artist.name,
        processedArtists: processedCount,
        totalArtists: artists.length,
      });
      const genres = artist.genres ?? [];
      for (const g of genres) {
        allGenres.add(g);
      }

      // Check shared artist cache first
      let releases = await getArtistReleasesCached(artist.id);
      let skippedThisArtist = false;

      if (!releases) {
        // Fetch fresh from Spotify
        log.info('Fetching artist albums from Spotify', {
          artistId: artist.id,
        });
        const freshToken = await getValidAccessToken(spotifyId);
        let albums: Awaited<ReturnType<typeof getArtistAlbums>> | undefined;
        try {
          albums = await getArtistAlbums(
            freshToken,
            artist.id,
            syncType === 'quick'
              ? { stopAfterYear: currentYear, market: country }
              : { market: country },
          );
        } catch (err) {
          if (err instanceof RetryBudgetExceededError) {
            consecutiveRateLimits++;
            log.warn('Rate limit exceeded — backing off before next artist', {
              artistId: artist.id,
              artistName: artist.name,
              consecutiveRateLimits,
            });
            skippedCount++;
            skippedThisArtist = true;
            if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
              log.warn('Aborting remaining artists after consecutive rate limit failures', {
                consecutiveRateLimits,
                remainingArtists: artists.length - processedCount - 1,
              });
              skippedCount += artists.length - processedCount - 1;
              processedCount++;
              await putSyncStatus(spotifyId, {
                status: 'running',
                syncType,
                totalArtists: artists.length,
                processedArtists: processedCount,
                startedAt: now,
                updatedAt: Date.now(),
              });
              break;
            }
            await sleep(RATE_LIMIT_BACKOFF_MS);
          } else if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
            log.warn('Skipping artist due to Spotify client error', {
              artistId: artist.id,
              artistName: artist.name,
              statusCode: err.statusCode,
            });
            skippedCount++;
            skippedThisArtist = true;
          } else {
            throw new Error(`Artist albums request failed: ${getErrorMessage(err)}`);
          }
          if (err instanceof RetryBudgetExceededError) {
            currentDelay = Math.min(currentDelay * 2, MAX_ARTIST_REQUEST_DELAY_MS);
          }
        }

        if (!skippedThisArtist && albums !== undefined) {
          consecutiveRateLimits = 0;
          currentDelay = Math.max(ARTIST_REQUEST_DELAY_MS, currentDelay - DELAY_RECOVERY_MS);
          await sleep(currentDelay);
          log.info('Fetched artist albums from Spotify', {
            artistId: artist.id,
            albumCount: albums.length,
          });
          releases = albums.map((a) => albumToRelease(a, artist.id, artist.name, genres));

          // Write to shared artist cache
          if (releases.length > 0) {
            await batchWriteArtistReleases(releases);
          }
        }
      }

      if (!skippedThisArtist && releases) {
        // For quick sync, filter to current year only
        const filtered =
          syncType === 'quick' ? releases.filter((r) => r.year === currentYear) : releases;

        // Dedup: skip albums already seen or already persisted
        const uniqueReleases = filtered.filter((r) => {
          if (seenAlbumIds.has(r.albumId)) return false;
          seenAlbumIds.add(r.albumId);
          return true;
        });

        // Write to user namespace
        if (uniqueReleases.length > 0) {
          await batchWriteUserReleases(spotifyId, uniqueReleases);
          for (const r of uniqueReleases) {
            allYears.add(r.year);
          }
        }
      }

      processedCount++;
      await putSyncStatus(spotifyId, {
        status: 'running',
        syncType,
        totalArtists: artists.length,
        processedArtists: processedCount,
        startedAt: now,
        updatedAt: Date.now(),
      });
      log.info('Finished processing artist releases', {
        artistId: artist.id,
        processedArtists: processedCount,
        totalArtists: artists.length,
      });
    }

    if (skippedCount > 0) {
      log.warn('Some artists were skipped during sync', {
        skippedCount,
        totalArtists: artists.length,
      });
    }

    // Years index: for quick sync merge into existing; for full sync rebuild
    if (syncType === 'quick') {
      const existingYears = await getYearsIndex(spotifyId);
      for (const y of existingYears) {
        allYears.add(y);
      }
    }
    const sortedYears = Array.from(allYears).sort().reverse();
    await putYearsIndex(spotifyId, sortedYears);

    const sortedGenres = Array.from(allGenres).sort();
    await putGenresIndex(spotifyId, sortedGenres);

    await putSyncStatus(spotifyId, {
      status: 'done',
      syncType,
      totalArtists: artists.length,
      processedArtists: artists.length,
      startedAt: now,
      updatedAt: Date.now(),
    });

    const syncOpts =
      skippedCount === 0
        ? syncType === 'quick'
          ? { lastQuickSyncAt: Date.now() }
          : { lastFullSyncAt: Date.now() }
        : undefined;
    await updateSyncStatus(spotifyId, 'done', syncOpts);
    log.info('Sync completed', { artistCount: artists.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logUnknownError(log, 'Sync failed', err, { message });
    await putSyncStatus(spotifyId, {
      status: 'error',
      syncType,
      totalArtists: 0,
      processedArtists: 0,
      errorMessage: message,
      startedAt: now,
      updatedAt: Date.now(),
    });
    await updateSyncStatus(spotifyId, 'error');
    throw err;
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}
