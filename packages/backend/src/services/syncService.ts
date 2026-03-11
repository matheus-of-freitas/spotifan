import { getFollowedArtists, getArtistAlbums } from './spotifyClient.js';
import { getValidAccessToken } from './tokenService.js';
import {
  batchWriteUserReleases,
  batchWriteArtistReleases,
  getArtistReleasesCached,
  getUserExistingAlbumIds,
  getYearsIndex,
  putYearsIndex,
  putGenresIndex,
} from '../db/releases.js';
import { putSyncStatus } from '../db/sync.js';
import { updateSyncStatus } from '../db/users.js';
import type { Release } from '../db/releases.js';
import type { SpotifyAlbum } from './spotifyClient.js';
import { createChildLogger, logUnknownError } from '../lib/logger.js';

const CONCURRENCY = 5;

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

async function processBatch<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

export async function runSync(spotifyId: string, syncType: 'quick' | 'full'): Promise<void> {
  const now = Date.now();
  const currentYear = new Date().getFullYear().toString();
  const log = createChildLogger({ operation: 'runSync', spotifyId, syncType });
  log.info('Sync started');

  await putSyncStatus(spotifyId, {
    status: 'running',
    syncType,
    totalArtists: 0,
    processedArtists: 0,
    startedAt: now,
    updatedAt: now,
  });
  await updateSyncStatus(spotifyId, 'running');

  try {
    log.info('Fetching access token for sync');
    const accessToken = await getValidAccessToken(spotifyId);
    log.info('Fetched access token for sync');

    log.info('Fetching followed artists');
    const artists = await getFollowedArtists(accessToken);
    log.info('Fetched followed artists', { artistCount: artists.length });

    await putSyncStatus(spotifyId, {
      status: 'running',
      syncType,
      totalArtists: artists.length,
      processedArtists: 0,
      startedAt: now,
      updatedAt: Date.now(),
    });

    // Load existing album IDs to skip already-persisted albums
    const existingAlbumIds = await getUserExistingAlbumIds(spotifyId);
    const seenAlbumIds = new Set<string>(existingAlbumIds);
    const allYears = new Set<string>();
    const allGenres = new Set<string>();
    let processedCount = 0;

    await processBatch(artists, CONCURRENCY, async (artist) => {
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

      if (!releases) {
        // Fetch fresh from Spotify
        log.info('Fetching artist albums from Spotify', {
          artistId: artist.id,
        });
        const freshToken = await getValidAccessToken(spotifyId);
        const albums = await getArtistAlbums(
          freshToken,
          artist.id,
          syncType === 'quick' ? { stopAfterYear: currentYear } : {},
        );
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
    });

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

    const syncTimestamp = Date.now();
    const syncOpts =
      syncType === 'quick' ? { lastQuickSyncAt: syncTimestamp } : { lastFullSyncAt: syncTimestamp };
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
