import { describe, it, expect, vi, beforeEach } from 'vitest';

const { gotGetMock } = vi.hoisted(() => {
  const gotGetMock = vi.fn();
  return { gotGetMock };
});

vi.mock('got', () => ({
  default: {
    get: gotGetMock,
  },
}));

vi.mock('../../lib/retry.js', () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
}));

import { getFollowedArtists, getArtistAlbums } from '../spotifyClient.js';

describe('spotifyClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
