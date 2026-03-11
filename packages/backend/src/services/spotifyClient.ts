import got from 'got';
import { withRetry } from '../lib/retry.js';
import { AppError, TooManyRequestsError } from '../lib/errors.js';
import { createChildLogger } from '../lib/logger.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_FOLLOWED_ARTIST_PAGES = 200;

interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
}

interface SpotifyFollowedArtistsResponse {
  artists: {
    items: SpotifyArtist[];
    next: string | null;
    cursors: { after: string | null };
    total: number;
  };
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  album_type: string;
  release_date: string;
  images: Array<{ url: string }>;
  external_urls: { spotify: string };
  artists: Array<{ id: string; name: string }>;
}

interface SpotifyAlbumsResponse {
  items: SpotifyAlbum[];
  next: string | null;
  total: number;
}

interface ArtistAlbumOptions {
  stopAfterYear?: string;
}

function handleSpotifyError(err: unknown): never {
  if (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    typeof (err as { response: unknown }).response === 'object'
  ) {
    const response = (err as { response: { statusCode: number; body?: string } }).response;
    if (response.statusCode === 429) {
      const retryAfter =
        'headers' in response
          ? Number((response as { headers: Record<string, string> }).headers['retry-after'] ?? '1')
          : 1;
      throw new TooManyRequestsError(retryAfter);
    }
    throw new AppError(response.statusCode, `Spotify API error: ${response.statusCode}`);
  }
  throw err;
}

export async function getFollowedArtists(accessToken: string): Promise<SpotifyArtist[]> {
  const log = createChildLogger({ operation: 'getFollowedArtists' });
  const artists: SpotifyArtist[] = [];
  let after: string | undefined;
  let pageCount = 0;
  const seenCursors = new Set<string>();

  do {
    pageCount++;
    if (pageCount > MAX_FOLLOWED_ARTIST_PAGES) {
      throw new Error('Spotify followed artists pagination exceeded expected page limit');
    }

    const params = new URLSearchParams({ type: 'artist', limit: '50' });
    if (after) params.set('after', after);

    const page = await withRetry(async () => {
      try {
        return await got
          .get(`https://api.spotify.com/v1/me/following?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: { request: REQUEST_TIMEOUT_MS },
          })
          .json<SpotifyFollowedArtistsResponse>();
      } catch (err) {
        handleSpotifyError(err);
      }
    });

    const nextAfter = page.artists.cursors.after ?? undefined;
    log.info('Fetched Spotify followed artists page', {
      page: pageCount,
      itemCount: page.artists.items.length,
      after,
      nextAfter,
    });

    if (nextAfter && nextAfter === after) {
      log.error('Spotify followed artists pagination did not advance', { after, nextAfter });
      throw new Error('Spotify followed artists pagination did not advance');
    }
    if (nextAfter && seenCursors.has(nextAfter)) {
      log.error('Spotify followed artists pagination repeated a cursor', { after, nextAfter });
      throw new Error('Spotify followed artists pagination repeated a cursor');
    }
    if (page.artists.next !== null && page.artists.items.length === 0) {
      log.error('Spotify followed artists pagination returned an empty page before completion');
      throw new Error('Spotify followed artists pagination returned an empty page before completion');
    }

    artists.push(...page.artists.items);
    if (nextAfter) {
      seenCursors.add(nextAfter);
    }
    after = nextAfter;
  } while (after);

  return artists;
}

export async function getArtistAlbums(
  accessToken: string,
  artistId: string,
  options: ArtistAlbumOptions = {},
): Promise<SpotifyAlbum[]> {
  const log = createChildLogger({
    operation: 'getArtistAlbums',
    artistId,
    stopAfterYear: options.stopAfterYear,
  });
  const albums: SpotifyAlbum[] = [];
  let offset = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      include_groups: 'album',
      limit: String(limit),
      offset: String(offset),
    });

    const page = await withRetry(async () => {
      try {
        return await got
          .get(`https://api.spotify.com/v1/artists/${artistId}/albums?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: { request: REQUEST_TIMEOUT_MS },
          })
          .json<SpotifyAlbumsResponse>();
      } catch (err) {
        handleSpotifyError(err);
      }
    });

    log.info('Fetched Spotify artist albums page', {
      artistId,
      offset,
      itemCount: page.items.length,
      hasNextPage: page.next !== null,
    });
    albums.push(...page.items);
    offset += limit;

    if (!options.stopAfterYear) {
      hasMore = page.next !== null;
      continue;
    }

    const cutoffYear = options.stopAfterYear;
    const hasAlbumsAtOrAboveCutoff = page.items.some(
      (album) => album.release_date.slice(0, 4) >= cutoffYear,
    );
    hasMore = page.next !== null && hasAlbumsAtOrAboveCutoff;
  }

  return albums;
}
