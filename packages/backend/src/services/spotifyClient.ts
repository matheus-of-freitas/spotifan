import got from 'got';
import { withRetry } from '../lib/retry.js';
import { AppError, TooManyRequestsError } from '../lib/errors.js';
import { createChildLogger } from '../lib/logger.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_FOLLOWED_ARTIST_PAGES = 200;
const SPOTIFY_RETRY_BUDGET_MS = 60_000;

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
  market?: string;
}

interface SpotifyRequestLogContext {
  [key: string]: string | number | boolean | undefined;
  operation: 'followed_artists' | 'artist_albums';
  artistId?: string;
  page?: number;
  after?: string;
  offset?: number;
  limit?: number;
  stopAfterYear?: string;
}

interface SpotifyErrorContext {
  category: 'rate_limited' | 'spotify_http_error' | 'network_error' | 'unknown_error';
  statusCode?: number;
  retryAfter?: number;
  code?: string;
  message: string;
  responseBody?: string;
  normalizedError: Error;
}

function extractSpotifyErrorDetail(body: unknown): string | undefined {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
  } catch {
    // not JSON — fall through
  }
  return body.length > 200 ? body.slice(0, 200) : body;
}

function getSpotifyErrorContext(err: unknown): SpotifyErrorContext {
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
      return {
        category: 'rate_limited',
        statusCode: response.statusCode,
        retryAfter,
        message: 'Spotify API rate limited the request',
        normalizedError: new TooManyRequestsError(retryAfter),
      };
    }

    const bodyDetail = extractSpotifyErrorDetail(response.body);
    const message = bodyDetail
      ? `Spotify API error: ${response.statusCode} — ${bodyDetail}`
      : `Spotify API error: ${response.statusCode}`;

    return {
      category: 'spotify_http_error',
      statusCode: response.statusCode,
      message,
      responseBody: typeof response.body === 'string' ? response.body : undefined,
      normalizedError: new AppError(response.statusCode, message),
    };
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  ) {
    const code = (err as { code: string }).code;
    return {
      category: isNetworkError(err) ? 'network_error' : 'unknown_error',
      code,
      message: err instanceof Error ? err.message : 'Unknown Spotify request failure',
      normalizedError: err instanceof Error ? err : new Error(String(err)),
    };
  }

  return {
    category: 'unknown_error',
    message: err instanceof Error ? err.message : 'Unknown Spotify request failure',
    normalizedError: err instanceof Error ? err : new Error(String(err)),
  };
}

async function requestSpotify<T>(
  accessToken: string,
  url: string,
  context: SpotifyRequestLogContext,
): Promise<T> {
  const log = createChildLogger(context);
  let attempt = 0;

  return withRetry(
    async () => {
      attempt++;
      log.info('Requesting Spotify API', {
        ...context,
        attempt,
        url,
      });

      try {
        const response = await got
          .get(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: { request: REQUEST_TIMEOUT_MS },
            retry: { limit: 0 },
          })
          .json<T>();

        log.info('Spotify API request succeeded', {
          ...context,
          attempt,
          url,
        });
        return response;
      } catch (err) {
        const errorContext = getSpotifyErrorContext(err);
        log.error('Spotify API request failed', {
          ...context,
          attempt,
          url,
          category: errorContext.category,
          statusCode: errorContext.statusCode ?? null,
          retryAfter: errorContext.retryAfter ?? null,
          code: errorContext.code ?? null,
          errorMessage: errorContext.message,
          responseBody: errorContext.responseBody ?? null,
        });
        throw errorContext.normalizedError;
      }
    },
    {
      maxAttempts: 5,
      maxElapsedMs: SPOTIFY_RETRY_BUDGET_MS,
      operation:
        context.operation === 'followed_artists'
          ? 'Spotify followed artists fetch'
          : 'Spotify artist albums fetch',
      onRetry: ({ attempt: retryAttempt, cause, delayMs, elapsedMs }) => {
        log.info('Retrying Spotify API request', {
          ...context,
          attempt: retryAttempt,
          cause,
          delayMs,
          elapsedMs,
          url,
        });
      },
    },
  );
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
      log.error('Spotify followed artists pagination exceeded expected page limit', {
        page: pageCount,
      });
      throw new Error('Spotify followed artists pagination exceeded expected page limit');
    }

    const params = new URLSearchParams({ type: 'artist', limit: '50' });
    if (after) params.set('after', after);

    const page = await requestSpotify<SpotifyFollowedArtistsResponse>(
      accessToken,
      `https://api.spotify.com/v1/me/following?${params}`,
      {
        operation: 'followed_artists',
        page: pageCount,
        after,
      },
    );

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
      throw new Error(
        'Spotify followed artists pagination returned an empty page before completion',
      );
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
  const limit = 10;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      include_groups: 'album',
      limit: String(limit),
      offset: String(offset),
    });
    if (options.market) params.set('market', options.market);

    const page = await requestSpotify<SpotifyAlbumsResponse>(
      accessToken,
      `https://api.spotify.com/v1/artists/${artistId}/albums?${params}`,
      {
        operation: 'artist_albums',
        artistId,
        offset,
        limit,
        stopAfterYear: options.stopAfterYear,
      },
    );

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

export async function getSpotifyUserCountry(accessToken: string): Promise<string> {
  const profile = await requestSpotify<{ country: string }>(
    accessToken,
    'https://api.spotify.com/v1/me',
    { operation: 'followed_artists' },
  );
  return profile.country;
}

function isNetworkError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ERR_GOT_REQUEST_ERROR'].includes(
      (err as { code: string }).code,
    )
  );
}
