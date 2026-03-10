import { getFollowedArtists, getArtistAlbums } from './spotifyClient.js';
import { getValidAccessToken } from './tokenService.js';
import {
  batchWriteUserReleases,
  batchWriteArtistReleases,
  getArtistReleasesCached,
  putYearsIndex,
} from '../db/releases.js';
import { putSyncStatus } from '../db/sync.js';
import { updateSyncStatus } from '../db/users.js';
import type { Release } from '../db/releases.js';
import type { SpotifyAlbum } from './spotifyClient.js';

const CONCURRENCY = 5;

function albumToRelease(album: SpotifyAlbum, artistId: string, artistName: string): Release {
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

export async function runSync(spotifyId: string): Promise<void> {
  const now = Date.now();

  await putSyncStatus(spotifyId, {
    status: 'running',
    totalArtists: 0,
    processedArtists: 0,
    startedAt: now,
    updatedAt: now,
  });
  await updateSyncStatus(spotifyId, 'running');

  try {
    const accessToken = await getValidAccessToken(spotifyId);
    const artists = await getFollowedArtists(accessToken);

    await putSyncStatus(spotifyId, {
      status: 'running',
      totalArtists: artists.length,
      processedArtists: 0,
      startedAt: now,
      updatedAt: Date.now(),
    });

    const seenAlbumIds = new Set<string>();
    const allYears = new Set<string>();
    let processedCount = 0;

    await processBatch(artists, CONCURRENCY, async (artist) => {
      // Check shared artist cache first
      let releases = await getArtistReleasesCached(artist.id);

      if (!releases) {
        // Fetch fresh from Spotify
        const freshToken = await getValidAccessToken(spotifyId);
        const albums = await getArtistAlbums(freshToken, artist.id);
        releases = albums.map((a) => albumToRelease(a, artist.id, artist.name));

        // Write to shared artist cache
        if (releases.length > 0) {
          await batchWriteArtistReleases(releases);
        }
      }

      // Dedup: skip albums already seen from another artist (collabs)
      const uniqueReleases = releases.filter((r) => {
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
        totalArtists: artists.length,
        processedArtists: processedCount,
        startedAt: now,
        updatedAt: Date.now(),
      });
    });

    // Write years index
    const sortedYears = Array.from(allYears).sort().reverse();
    await putYearsIndex(spotifyId, sortedYears);

    await putSyncStatus(spotifyId, {
      status: 'done',
      totalArtists: artists.length,
      processedArtists: artists.length,
      startedAt: now,
      updatedAt: Date.now(),
    });
    await updateSyncStatus(spotifyId, 'done', Date.now());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await putSyncStatus(spotifyId, {
      status: 'error',
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
