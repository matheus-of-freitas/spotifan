import got from 'got';
import { withRetry } from '../lib/retry.js';
import { AppError, TooManyRequestsError } from '../lib/errors.js';

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
  const artists: SpotifyArtist[] = [];
  let after: string | undefined;

  do {
    const params = new URLSearchParams({ type: 'artist', limit: '50' });
    if (after) params.set('after', after);

    const page = await withRetry(async () => {
      try {
        return await got
          .get(`https://api.spotify.com/v1/me/following?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          .json<SpotifyFollowedArtistsResponse>();
      } catch (err) {
        handleSpotifyError(err);
      }
    });

    artists.push(...page.artists.items);
    after = page.artists.cursors.after ?? undefined;
  } while (after);

  return artists;
}

export async function getArtistAlbums(
  accessToken: string,
  artistId: string,
): Promise<SpotifyAlbum[]> {
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

    const page = await withRetry(async () => {
      try {
        return await got
          .get(`https://api.spotify.com/v1/artists/${artistId}/albums?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          .json<SpotifyAlbumsResponse>();
      } catch (err) {
        handleSpotifyError(err);
      }
    });

    albums.push(...page.items);
    offset += limit;
    hasMore = page.next !== null;
  }

  return albums;
}
