import { describe, it, expect, vi, beforeEach } from 'vitest';

const { gotGetMock } = vi.hoisted(() => {
  const gotGetMock = vi.fn();
  return { gotGetMock };
});

const { loggerMock, createChildLoggerMock } = vi.hoisted(() => {
  const loggerMock = {
    info: vi.fn(),
    error: vi.fn(),
    appendKeys: vi.fn(),
    addContext: vi.fn(),
  };
  const createChildLoggerMock = vi.fn(() => loggerMock);
  return { loggerMock, createChildLoggerMock };
});

const { withRetryMock } = vi.hoisted(() => {
  const withRetryMock = vi.fn(async <T>(fn: () => Promise<T>) => fn());
  return { withRetryMock };
});

vi.mock('got', () => ({
  default: {
    get: gotGetMock,
  },
}));

vi.mock('../../lib/retry.js', () => ({
  withRetry: withRetryMock,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: loggerMock,
  createChildLogger: createChildLoggerMock,
}));

import { getFollowedArtists, getArtistAlbums } from '../spotifyClient.js';

describe('spotifyClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withRetryMock.mockImplementation(async <T>(fn: () => Promise<T>) => fn());
  });

  describe('getFollowedArtists', () => {
    it('fetches a single page of followed artists', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          artists: {
            items: [
              { id: 'a1', name: 'Artist 1', genres: ['rock'] },
              { id: 'a2', name: 'Artist 2', genres: ['pop'] },
            ],
            next: null,
            cursors: { after: null },
            total: 2,
          },
        }),
      });

      const result = await getFollowedArtists('token123');

      expect(result).toEqual([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      ]);
      expect(gotGetMock).toHaveBeenCalledOnce();
      expect(gotGetMock.mock.calls[0]![0]).toContain('type=artist');
      expect(gotGetMock.mock.calls[0]![0]).toContain('limit=50');
      expect(gotGetMock.mock.calls[0]![1]).toEqual({
        headers: { Authorization: 'Bearer token123' },
        timeout: { request: 30_000 },
      });
    });

    it('paginates through multiple pages using cursor', async () => {
      gotGetMock
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            artists: {
              items: [{ id: 'a1', name: 'Artist 1', genres: ['rock'] }],
              next: 'https://next',
              cursors: { after: 'cursor1' },
              total: 2,
            },
          }),
        })
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            artists: {
              items: [{ id: 'a2', name: 'Artist 2', genres: ['pop'] }],
              next: null,
              cursors: { after: null },
              total: 2,
            },
          }),
        });

      const result = await getFollowedArtists('token123');

      expect(result).toHaveLength(2);
      expect(gotGetMock).toHaveBeenCalledTimes(2);
      expect(gotGetMock.mock.calls[1]![0]).toContain('after=cursor1');
    });

    it('throws when followed artist pagination repeats a cursor', async () => {
      gotGetMock
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            artists: {
              items: [{ id: 'a1', name: 'Artist 1', genres: ['rock'] }],
              next: 'https://next',
              cursors: { after: 'cursor1' },
              total: 2,
            },
          }),
        })
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            artists: {
              items: [{ id: 'a2', name: 'Artist 2', genres: ['pop'] }],
              next: 'https://next-again',
              cursors: { after: 'cursor2' },
              total: 3,
            },
          }),
        })
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            artists: {
              items: [{ id: 'a3', name: 'Artist 3', genres: ['jazz'] }],
              next: 'https://next-third',
              cursors: { after: 'cursor1' },
              total: 3,
            },
          }),
        });

      await expect(getFollowedArtists('token123')).rejects.toThrow(
        'Spotify followed artists pagination repeated a cursor',
      );
    });

    it('throws when followed artist pagination does not advance', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          artists: {
            items: [{ id: 'a1', name: 'Artist 1', genres: ['rock'] }],
            next: 'https://next',
            cursors: { after: 'cursor0' },
            total: 2,
          },
        }),
      });

      await expect(getFollowedArtists('token123')).rejects.toThrow(
        'Spotify followed artists pagination did not advance',
      );
    });

    it('throws when followed artist pagination returns an empty page before completion', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          artists: {
            items: [],
            next: 'https://next',
            cursors: { after: 'cursor1' },
            total: 2,
          },
        }),
      });

      await expect(getFollowedArtists('token123')).rejects.toThrow(
        'Spotify followed artists pagination returned an empty page before completion',
      );
    });

    it('throws when followed artist pagination exceeds the page limit', async () => {
      let cursor = 0;
      gotGetMock.mockImplementation(() => {
        cursor++;
        return {
          json: vi.fn().mockResolvedValue({
            artists: {
              items: [{ id: 'a1', name: 'Artist 1', genres: ['rock'] }],
              next: 'https://next',
              cursors: { after: `cursor-${cursor}` },
              total: 10001,
            },
          }),
        };
      });

      await expect(getFollowedArtists('token123')).rejects.toThrow(
        'Spotify followed artists pagination exceeded expected page limit',
      );
      expect(gotGetMock).toHaveBeenCalledTimes(200);
    });

    it('throws TooManyRequestsError on 429', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue({
          response: {
            statusCode: 429,
            headers: { 'retry-after': '5' },
          },
        }),
      });

      await expect(getFollowedArtists('token')).rejects.toThrow('Too many requests');
    });

    it('throws TooManyRequestsError on 429 without retry-after header', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue({
          response: {
            statusCode: 429,
            headers: {},
          },
        }),
      });

      await expect(getFollowedArtists('token')).rejects.toThrow('Too many requests');
    });

    it('throws AppError on other HTTP errors', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue({
          response: { statusCode: 403, body: 'Forbidden' },
        }),
      });

      await expect(getFollowedArtists('token')).rejects.toThrow('Spotify API error: 403');
    });

    it('rethrows non-HTTP errors', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue(new Error('Network error')),
      });

      await expect(getFollowedArtists('token')).rejects.toThrow('Network error');
    });

    it('rethrows network errors with known codes', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' })),
      });

      await expect(getFollowedArtists('token')).rejects.toThrow('Timeout');
    });

    it('rethrows errors with unknown codes', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue(Object.assign(new Error('Unknown'), { code: 'EUNKNOWN' })),
      });

      await expect(getFollowedArtists('token')).rejects.toThrow('Unknown');
    });

    it('normalizes non-Error network failures in logs before rethrowing them', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue({ code: 'ETIMEDOUT', message: 'Timeout' }),
      });

      await expect(getFollowedArtists('token')).rejects.toThrow('[object Object]');
      expect(loggerMock.error).toHaveBeenCalledWith('Spotify API request failed', {
        operation: 'followed_artists',
        page: 1,
        after: undefined,
        attempt: 1,
        url: 'https://api.spotify.com/v1/me/following?type=artist&limit=50',
        category: 'network_error',
        statusCode: null,
        retryAfter: null,
        code: 'ETIMEDOUT',
        errorMessage: 'Unknown Spotify request failure',
      });
    });

    it('logs primitive Spotify request failures as unknown errors', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue('boom'),
      });

      await expect(getFollowedArtists('token')).rejects.toThrow('boom');
      expect(loggerMock.error).toHaveBeenCalledWith('Spotify API request failed', {
        operation: 'followed_artists',
        page: 1,
        after: undefined,
        attempt: 1,
        url: 'https://api.spotify.com/v1/me/following?type=artist&limit=50',
        category: 'unknown_error',
        statusCode: null,
        retryAfter: null,
        code: null,
        errorMessage: 'Unknown Spotify request failure',
      });
    });

    it('logs retry metadata when the retry layer retries a Spotify request', async () => {
      withRetryMock.mockImplementationOnce(
        async <T>(
          fn: () => Promise<T>,
          options?: {
            onRetry?: (context: {
              attempt: number;
              cause: string;
              delayMs: number;
              elapsedMs: number;
            }) => void;
          },
        ) => {
          options?.onRetry?.({
            attempt: 1,
            cause: 'network_error',
            delayMs: 1000,
            elapsedMs: 200,
          });
          return fn();
        },
      );
      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          artists: {
            items: [],
            next: null,
            cursors: { after: null },
            total: 0,
          },
        }),
      });

      await getFollowedArtists('token');

      expect(loggerMock.info).toHaveBeenCalledWith('Retrying Spotify API request', {
        operation: 'followed_artists',
        page: 1,
        after: undefined,
        attempt: 1,
        cause: 'network_error',
        delayMs: 1000,
        elapsedMs: 200,
        url: 'https://api.spotify.com/v1/me/following?type=artist&limit=50',
      });
    });
  });

  describe('getArtistAlbums', () => {
    it('fetches albums with include_groups=album', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          items: [
            {
              id: 'alb1',
              name: 'Album 1',
              album_type: 'album',
              release_date: '2024-01-15',
              images: [{ url: 'https://img.com/1.jpg' }],
              external_urls: { spotify: 'https://open.spotify.com/album/alb1' },
              artists: [{ id: 'a1', name: 'Artist 1', genres: ['rock'] }],
            },
          ],
          next: null,
          total: 1,
        }),
      });

      const result = await getArtistAlbums('token', 'a1');

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('alb1');
      expect(gotGetMock.mock.calls[0]![0]).toContain('include_groups=album');
      expect(gotGetMock.mock.calls[0]![0]).toContain('market=from_token');
      expect(gotGetMock.mock.calls[0]![0]).toContain('limit=50');
    });

    it('paginates through multiple pages', async () => {
      gotGetMock
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            items: [
              {
                id: 'alb1',
                name: 'Album 1',
                album_type: 'album',
                release_date: '2024-01-15',
                images: [],
                external_urls: { spotify: 'https://spotify.com/alb1' },
                artists: [{ id: 'a1', name: 'A' }],
              },
            ],
            next: 'https://next-page',
            total: 2,
          }),
        })
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            items: [
              {
                id: 'alb2',
                name: 'Album 2',
                album_type: 'album',
                release_date: '2023-06-01',
                images: [],
                external_urls: { spotify: 'https://spotify.com/alb2' },
                artists: [{ id: 'a1', name: 'A' }],
              },
            ],
            next: null,
            total: 2,
          }),
        });

      const result = await getArtistAlbums('token', 'a1');

      expect(result).toHaveLength(2);
      expect(gotGetMock).toHaveBeenCalledTimes(2);
      expect(gotGetMock.mock.calls[1]![0]).toContain('offset=50');
    });

    it('logs retry metadata for artist album requests when the retry layer retries', async () => {
      withRetryMock.mockImplementationOnce(
        async <T>(
          fn: () => Promise<T>,
          options?: {
            onRetry?: (context: {
              attempt: number;
              cause: string;
              delayMs: number;
              elapsedMs: number;
            }) => void;
          },
        ) => {
          options?.onRetry?.({
            attempt: 1,
            cause: 'server_error',
            delayMs: 1000,
            elapsedMs: 150,
          });
          return fn();
        },
      );
      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          items: [],
          next: null,
          total: 0,
        }),
      });

      await getArtistAlbums('token', 'artist-1');

      expect(loggerMock.info).toHaveBeenCalledWith('Retrying Spotify API request', {
        operation: 'artist_albums',
        artistId: 'artist-1',
        offset: 0,
        limit: 50,
        stopAfterYear: undefined,
        attempt: 1,
        cause: 'server_error',
        delayMs: 1000,
        elapsedMs: 150,
        url: 'https://api.spotify.com/v1/artists/artist-1/albums?include_groups=album&market=from_token&limit=50&offset=0',
      });
    });

    it('stops paginating once pages are older than the quick sync cutoff year', async () => {
      gotGetMock
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            items: [
              {
                id: 'alb1',
                name: 'Album 1',
                album_type: 'album',
                release_date: '2026-01-15',
                images: [],
                external_urls: { spotify: 'https://spotify.com/alb1' },
                artists: [{ id: 'a1', name: 'A' }],
              },
            ],
            next: 'https://next-page',
            total: 2,
          }),
        })
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            items: [
              {
                id: 'alb2',
                name: 'Album 2',
                album_type: 'album',
                release_date: '2025-06-01',
                images: [],
                external_urls: { spotify: 'https://spotify.com/alb2' },
                artists: [{ id: 'a1', name: 'A' }],
              },
            ],
            next: 'https://ignored-page',
            total: 3,
          }),
        });

      const result = await getArtistAlbums('token', 'a1', { stopAfterYear: '2026' });

      expect(result).toHaveLength(2);
      expect(gotGetMock).toHaveBeenCalledTimes(2);
    });

    it('continues paginating when no cutoff year is provided', async () => {
      gotGetMock
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            items: [
              {
                id: 'alb1',
                name: 'Album 1',
                album_type: 'album',
                release_date: '2024-01-15',
                images: [],
                external_urls: { spotify: 'https://spotify.com/alb1' },
                artists: [{ id: 'a1', name: 'A' }],
              },
            ],
            next: 'https://next-page',
            total: 2,
          }),
        })
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({
            items: [
              {
                id: 'alb2',
                name: 'Album 2',
                album_type: 'album',
                release_date: '2023-06-01',
                images: [],
                external_urls: { spotify: 'https://spotify.com/alb2' },
                artists: [{ id: 'a1', name: 'A' }],
              },
            ],
            next: null,
            total: 2,
          }),
        });

      const result = await getArtistAlbums('token', 'a1');

      expect(result).toHaveLength(2);
      expect(gotGetMock).toHaveBeenCalledTimes(2);
    });

    it('throws TooManyRequestsError on 429 with default retry-after', async () => {
      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue({
          response: {
            statusCode: 429,
          },
        }),
      });

      await expect(getArtistAlbums('token', 'a1')).rejects.toThrow('Too many requests');
    });
  });
});
