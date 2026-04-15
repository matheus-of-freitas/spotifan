import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getFollowedArtistsMock, getArtistAlbumsMock, getSpotifyUserCountryMock } = vi.hoisted(
  () => {
    const getFollowedArtistsMock = vi.fn();
    const getArtistAlbumsMock = vi.fn();
    const getSpotifyUserCountryMock = vi.fn();
    return { getFollowedArtistsMock, getArtistAlbumsMock, getSpotifyUserCountryMock };
  },
);

const { getValidAccessTokenMock } = vi.hoisted(() => {
  const getValidAccessTokenMock = vi.fn();
  return { getValidAccessTokenMock };
});

const {
  batchWriteUserReleasesMock,
  batchWriteArtistReleasesMock,
  getArtistReleasesCachedMock,
  getUserExistingAlbumIdsMock,
  getYearsIndexMock,
  putYearsIndexMock,
  putGenresIndexMock,
  putArtistsIndexMock,
  getArtistsIndexMock,
} = vi.hoisted(() => ({
  batchWriteUserReleasesMock: vi.fn(),
  batchWriteArtistReleasesMock: vi.fn(),
  getArtistReleasesCachedMock: vi.fn(),
  getUserExistingAlbumIdsMock: vi.fn(),
  getYearsIndexMock: vi.fn(),
  putYearsIndexMock: vi.fn(),
  putGenresIndexMock: vi.fn(),
  putArtistsIndexMock: vi.fn(),
  getArtistsIndexMock: vi.fn(),
}));

const { putSyncStatusMock } = vi.hoisted(() => ({
  putSyncStatusMock: vi.fn(),
}));

const { getUserMock, putUserMock, updateSyncStatusMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  putUserMock: vi.fn(),
  updateSyncStatusMock: vi.fn(),
}));

const { sleepMock } = vi.hoisted(() => ({
  sleepMock: vi.fn().mockResolvedValue(undefined),
}));

const { loggerMock, createChildLoggerMock, logUnknownErrorMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    appendKeys: vi.fn(),
    addContext: vi.fn(),
  },
  createChildLoggerMock: vi.fn(),
  logUnknownErrorMock: vi.fn(),
}));

vi.mock('../../lib/retry.js', () => ({
  sleep: sleepMock,
  withRetry: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../spotifyClient.js', () => ({
  getFollowedArtists: getFollowedArtistsMock,
  getArtistAlbums: getArtistAlbumsMock,
  getSpotifyUserCountry: getSpotifyUserCountryMock,
}));

vi.mock('../tokenService.js', () => ({
  getValidAccessToken: getValidAccessTokenMock,
}));

vi.mock('../../db/releases.js', () => ({
  batchWriteUserReleases: batchWriteUserReleasesMock,
  batchWriteArtistReleases: batchWriteArtistReleasesMock,
  getArtistReleasesCached: getArtistReleasesCachedMock,
  getUserExistingAlbumIds: getUserExistingAlbumIdsMock,
  getYearsIndex: getYearsIndexMock,
  putYearsIndex: putYearsIndexMock,
  putGenresIndex: putGenresIndexMock,
  putArtistsIndex: putArtistsIndexMock,
  getArtistsIndex: getArtistsIndexMock,
}));

vi.mock('../../db/sync.js', () => ({
  putSyncStatus: putSyncStatusMock,
}));

vi.mock('../../db/users.js', () => ({
  getUser: getUserMock,
  putUser: putUserMock,
  updateSyncStatus: updateSyncStatusMock,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: loggerMock,
  createChildLogger: createChildLoggerMock,
  logUnknownError: logUnknownErrorMock,
}));

import { runSync } from '../syncService.js';
import type { SyncContinuation } from '../syncService.js';
import { AppError, RetryBudgetExceededError } from '../../lib/errors.js';

const currentYear = new Date().getFullYear().toString();

function makeAlbum(id: string, name: string, date: string, artistId: string, artistName: string) {
  return {
    id,
    name,
    album_type: 'album',
    release_date: date,
    images: [{ url: `https://img/${id}.jpg` }],
    external_urls: { spotify: `https://open.spotify.com/album/${id}` },
    artists: [{ id: artistId, name: artistName }],
  };
}

describe('syncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createChildLoggerMock.mockReturnValue(loggerMock);
    getValidAccessTokenMock.mockResolvedValue('access-token');
    getUserMock.mockResolvedValue({
      spotifyId: 'user1',
      displayName: 'Test User',
      country: 'BR',
      encryptedRefreshToken: 'enc-refresh',
      encryptedAccessToken: 'enc-access',
      tokenExpiresAt: Date.now() + 3600000,
      syncStatus: 'running',
    });
    putUserMock.mockResolvedValue(undefined);
    putSyncStatusMock.mockResolvedValue(undefined);
    updateSyncStatusMock.mockResolvedValue(undefined);
    batchWriteUserReleasesMock.mockResolvedValue(undefined);
    batchWriteArtistReleasesMock.mockResolvedValue(undefined);
    putYearsIndexMock.mockResolvedValue(undefined);
    putGenresIndexMock.mockResolvedValue(undefined);
    putArtistsIndexMock.mockResolvedValue(undefined);
    getArtistsIndexMock.mockResolvedValue([]);
    getUserExistingAlbumIdsMock.mockResolvedValue(new Set());
    getYearsIndexMock.mockResolvedValue([]);
  });

  it('syncs followed artists and writes releases (full sync)', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
    getArtistReleasesCachedMock.mockResolvedValue(null); // no cache
    getArtistAlbumsMock.mockResolvedValue([
      makeAlbum('alb1', 'Album 1', '2024-03-15', 'a1', 'Artist 1'),
    ]);

    await runSync('user1', 'full');

    // Should persist artists index
    expect(putArtistsIndexMock).toHaveBeenCalledWith('user1', [
      { id: 'a1', name: 'Artist 1', genres: ['rock'] },
    ]);

    // Should write to artist cache
    expect(batchWriteArtistReleasesMock).toHaveBeenCalledOnce();
    // Should write to user namespace
    expect(batchWriteUserReleasesMock).toHaveBeenCalledOnce();
    const userReleases = batchWriteUserReleasesMock.mock.calls[0]![1];
    expect(userReleases).toHaveLength(1);
    expect(userReleases[0].albumId).toBe('alb1');
    expect(userReleases[0].year).toBe('2024');

    // Should write years index
    expect(putYearsIndexMock).toHaveBeenCalledWith('user1', ['2024']);

    // Should write genres index
    expect(putGenresIndexMock).toHaveBeenCalledWith('user1', ['rock']);

    // Genres should be propagated to releases
    expect(userReleases[0].genres).toEqual(['rock']);

    // Should update sync status to done with lastFullSyncAt
    expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'done', {
      lastFullSyncAt: expect.any(Number),
    });
  });

  it('collects genres from multiple artists and writes sorted genres index', async () => {
    getFollowedArtistsMock.mockResolvedValue([
      { id: 'a1', name: 'Artist 1', genres: ['rock', 'indie'] },
      { id: 'a2', name: 'Artist 2', genres: ['pop', 'rock'] },
    ]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockResolvedValue([makeAlbum('alb1', 'Album', '2024-01-01', 'a1', 'A')]);

    await runSync('user1', 'full');

    // Genres should be deduplicated and sorted
    expect(putGenresIndexMock).toHaveBeenCalledWith('user1', ['indie', 'pop', 'rock']);
  });

  it('handles artists with missing genres gracefully', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: undefined }]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockResolvedValue([makeAlbum('alb1', 'Album', '2024-01-01', 'a1', 'A')]);

    await runSync('user1', 'full');

    expect(putGenresIndexMock).toHaveBeenCalledWith('user1', []);
    const userReleases = batchWriteUserReleasesMock.mock.calls[0]![1] as { genres: string[] }[];
    expect(userReleases[0]!.genres).toEqual([]);
  });

  it('uses cached artist releases when available', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
    getArtistReleasesCachedMock.mockResolvedValue([
      {
        albumId: 'alb1',
        title: 'Cached Album',
        artistId: 'a1',
        artistName: 'Artist 1',
        albumType: 'album',
        imageUrl: 'https://img/alb1.jpg',
        spotifyUrl: 'https://open.spotify.com/album/alb1',
        releaseDate: '2024-01-01',
        year: '2024',
        genres: ['rock'],
      },
    ]);

    await runSync('user1', 'full');

    // Should NOT call Spotify API for albums
    expect(getArtistAlbumsMock).not.toHaveBeenCalled();
    // Should NOT write to artist cache
    expect(batchWriteArtistReleasesMock).not.toHaveBeenCalled();
    // Should still write to user namespace
    expect(batchWriteUserReleasesMock).toHaveBeenCalledOnce();
  });

  it('deduplicates collab albums across artists', async () => {
    getFollowedArtistsMock.mockResolvedValue([
      { id: 'a1', name: 'Artist 1', genres: ['rock'] },
      { id: 'a2', name: 'Artist 2', genres: ['pop'] },
    ]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    // Same album under both artists (collab)
    getArtistAlbumsMock
      .mockResolvedValueOnce([makeAlbum('collab1', 'Collab Album', '2024-06-01', 'a1', 'Artist 1')])
      .mockResolvedValueOnce([
        makeAlbum('collab1', 'Collab Album', '2024-06-01', 'a2', 'Artist 2'),
      ]);

    await runSync('user1', 'full');

    // First artist's releases go through
    const firstCall = batchWriteUserReleasesMock.mock.calls[0]!;
    expect(firstCall[1]).toHaveLength(1);

    // Second artist's releases should be deduped (empty → no write)
    expect(batchWriteUserReleasesMock).toHaveBeenCalledOnce();
  });

  it('handles artist with no albums', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockResolvedValue([]); // no albums

    await runSync('user1', 'full');

    // Should not write to artist cache or user namespace
    expect(batchWriteArtistReleasesMock).not.toHaveBeenCalled();
    expect(batchWriteUserReleasesMock).not.toHaveBeenCalled();
    // Should still write years index (empty)
    expect(putYearsIndexMock).toHaveBeenCalledWith('user1', []);
  });

  it('sorts years in descending order', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockResolvedValue([
      makeAlbum('alb1', 'Old Album', '2020-01-01', 'a1', 'Artist 1'),
      makeAlbum('alb2', 'New Album', '2024-06-15', 'a1', 'Artist 1'),
      makeAlbum('alb3', 'Mid Album', '2022-08-10', 'a1', 'Artist 1'),
    ]);

    await runSync('user1', 'full');

    expect(putYearsIndexMock).toHaveBeenCalledWith('user1', ['2024', '2022', '2020']);
  });

  it('handles album with no images gracefully', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockResolvedValue([
      {
        id: 'alb1',
        name: 'No Image Album',
        album_type: 'album',
        release_date: '2024-01-01',
        images: [],
        external_urls: { spotify: 'https://open.spotify.com/album/alb1' },
        artists: [{ id: 'a1', name: 'Artist 1', genres: ['rock'] }],
      },
    ]);

    await runSync('user1', 'full');

    const releases = batchWriteUserReleasesMock.mock.calls[0]![1];
    expect(releases[0].imageUrl).toBe('');
  });

  it('sets error status on failure', async () => {
    getFollowedArtistsMock.mockRejectedValue(new Error('API down'));

    await expect(runSync('user1', 'full')).rejects.toThrow(
      'Followed artists request failed: API down',
    );

    // Should set error status with syncType
    const lastSyncStatusCall = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastSyncStatusCall.status).toBe('error');
    expect(lastSyncStatusCall.syncType).toBe('full');
    expect(lastSyncStatusCall.errorMessage).toBe('Followed artists request failed: API down');

    expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'error');
  });

  it('sets error status with unknown message for non-Error throws', async () => {
    getFollowedArtistsMock.mockRejectedValue('string error');

    await expect(runSync('user1', 'full')).rejects.toThrow(
      'Followed artists request failed: Unknown error',
    );

    const lastSyncStatusCall = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastSyncStatusCall.errorMessage).toBe('Followed artists request failed: Unknown error');
    expect(lastSyncStatusCall.syncType).toBe('full');
  });

  it('updates progress after each artist', async () => {
    getFollowedArtistsMock.mockResolvedValue([
      { id: 'a1', name: 'Artist 1', genres: ['rock'] },
      { id: 'a2', name: 'Artist 2', genres: ['pop'] },
    ]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockResolvedValue([makeAlbum('alb1', 'Album', '2024-01-01', 'a1', 'A')]);

    await runSync('user1', 'full');

    // putSyncStatus calls:
    // 1. initial running (0/0)
    // 2. running with totalArtists (0/2)
    // 3. after artist 1 (1/2)
    // 4. after artist 2 (2/2)
    // 5. done (2/2)
    const statusCalls = (
      putSyncStatusMock.mock.calls as [
        string,
        { status: string; syncType: string; processedArtists: number; totalArtists: number },
      ][]
    ).map((c) => ({
      status: c[1].status,
      syncType: c[1].syncType,
      processed: c[1].processedArtists,
      total: c[1].totalArtists,
    }));
    expect(statusCalls[0]).toEqual({ status: 'running', syncType: 'full', processed: 0, total: 0 });
    expect(statusCalls[1]).toEqual({ status: 'running', syncType: 'full', processed: 0, total: 2 });
    // Due to concurrency batch (both run in same batch of 5), order may vary
    expect(statusCalls[4]).toEqual({ status: 'done', syncType: 'full', processed: 2, total: 2 });
  });

  it('refreshes access token for each artist fetch', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockResolvedValue([]);

    await runSync('user1', 'full');

    // getValidAccessToken called once for followed artists, once for album fetch
    expect(getValidAccessTokenMock).toHaveBeenCalledTimes(2);
  });

  describe('quick sync', () => {
    it('reads artists from index, not Spotify', async () => {
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Current Album', `${currentYear}-06-15`, 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'quick');

      expect(getArtistsIndexMock).toHaveBeenCalledWith('user1');
      expect(getFollowedArtistsMock).not.toHaveBeenCalled();
      expect(putArtistsIndexMock).not.toHaveBeenCalled();
    });

    it('filters releases to current year only', async () => {
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Old Album', '2020-01-01', 'a1', 'Artist 1'),
        makeAlbum('alb2', 'Current Album', `${currentYear}-06-15`, 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'quick');

      // Only current year album should be written
      expect(batchWriteUserReleasesMock).toHaveBeenCalledOnce();
      const userReleases = batchWriteUserReleasesMock.mock.calls[0]![1];
      expect(userReleases).toHaveLength(1);
      expect(userReleases[0].year).toBe(currentYear);

      // Should update with lastQuickSyncAt
      expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'done', {
        lastQuickSyncAt: expect.any(Number),
      });
    });

    it('passes a current-year cutoff to artist album pagination', async () => {
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Current Album', `${currentYear}-06-15`, 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'quick');

      expect(getArtistAlbumsMock).toHaveBeenCalledWith(
        'access-token',
        'a1',
        expect.objectContaining({
          stopAfterYear: currentYear,
          market: 'BR',
        }),
      );
    });

    it('merges new years into existing years index', async () => {
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Current Album', `${currentYear}-03-01`, 'a1', 'Artist 1'),
      ]);
      getYearsIndexMock.mockResolvedValue(['2023', '2022']);

      await runSync('user1', 'quick');

      // Should merge current year with existing years
      expect(putYearsIndexMock).toHaveBeenCalledWith(
        'user1',
        expect.arrayContaining([currentYear, '2023', '2022']),
      );
      const years = putYearsIndexMock.mock.calls[0]![1] as string[];
      // Should be sorted descending
      expect(years).toEqual([...years].sort().reverse());
    });

    it('skips all releases when only old albums exist', async () => {
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Old Album', '2020-01-01', 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'quick');

      // No user releases written (all filtered out)
      expect(batchWriteUserReleasesMock).not.toHaveBeenCalled();
      // Artist cache should still be written
      expect(batchWriteArtistReleasesMock).toHaveBeenCalledOnce();
    });
  });

  describe('skipping existing albums', () => {
    it('skips albums already persisted in user releases', async () => {
      getUserExistingAlbumIdsMock.mockResolvedValue(new Set(['alb1']));
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Already Persisted', '2024-01-01', 'a1', 'Artist 1'),
        makeAlbum('alb2', 'New Album', '2024-06-01', 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'full');

      // Only alb2 should be written (alb1 already exists)
      expect(batchWriteUserReleasesMock).toHaveBeenCalledOnce();
      const userReleases = batchWriteUserReleasesMock.mock.calls[0]![1];
      expect(userReleases).toHaveLength(1);
      expect(userReleases[0].albumId).toBe('alb2');
    });

    it('skips all albums when all already exist', async () => {
      getUserExistingAlbumIdsMock.mockResolvedValue(new Set(['alb1']));
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Already Persisted', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'full');

      expect(batchWriteUserReleasesMock).not.toHaveBeenCalled();
    });
  });

  describe('full sync years index', () => {
    it('rebuilds years index from scratch (does not merge existing)', async () => {
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'full');

      // Should NOT call getYearsIndex for full sync
      expect(getYearsIndexMock).not.toHaveBeenCalled();
      expect(putYearsIndexMock).toHaveBeenCalledWith('user1', ['2024']);
    });

    it('fetches artist albums without a quick sync cutoff', async () => {
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'full');

      expect(getArtistAlbumsMock).toHaveBeenCalledWith(
        'access-token',
        'a1',
        expect.objectContaining({ market: 'BR' }),
      );
    });
  });

  describe('market / country', () => {
    it('passes market to getArtistAlbums from user country', async () => {
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album 1', '2024-03-15', 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'full');

      expect(getArtistAlbumsMock).toHaveBeenCalledWith(
        'access-token',
        'a1',
        expect.objectContaining({ market: 'BR' }),
      );
    });

    it('backfills country from Spotify when user has no country', async () => {
      getUserMock.mockResolvedValue({
        spotifyId: 'user1',
        displayName: 'Test User',
        encryptedRefreshToken: 'enc-refresh',
        encryptedAccessToken: 'enc-access',
        tokenExpiresAt: Date.now() + 3600000,
        syncStatus: 'running',
        // no country
      });
      getSpotifyUserCountryMock.mockResolvedValue('US');
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album 1', '2024-03-15', 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'full');

      expect(getSpotifyUserCountryMock).toHaveBeenCalledWith('access-token');
      expect(putUserMock).toHaveBeenCalledWith(
        expect.objectContaining({ spotifyId: 'user1', country: 'US' }),
      );
      expect(getArtistAlbumsMock).toHaveBeenCalledWith(
        'access-token',
        'a1',
        expect.objectContaining({ market: 'US' }),
      );
    });

    it('does not backfill when user already has country', async () => {
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([]);

      await runSync('user1', 'full');

      expect(getSpotifyUserCountryMock).not.toHaveBeenCalled();
      expect(putUserMock).not.toHaveBeenCalled();
    });

    it('skips putUser when getUser returns null during backfill', async () => {
      getUserMock.mockResolvedValue(null);
      getSpotifyUserCountryMock.mockResolvedValue('JP');
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([]);

      await runSync('user1', 'full');

      expect(getSpotifyUserCountryMock).toHaveBeenCalled();
      expect(putUserMock).not.toHaveBeenCalled();
      expect(getArtistAlbumsMock).toHaveBeenCalledWith(
        'access-token',
        'a1',
        expect.objectContaining({ market: 'JP' }),
      );
    });
  });

  it('wraps artist album failures with stage-specific context', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockRejectedValue(new Error('Spotify albums timeout'));

    await expect(runSync('user1', 'full')).rejects.toThrow(
      'Artist albums request failed: Spotify albums timeout',
    );

    const lastSyncStatusCall = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastSyncStatusCall.errorMessage).toBe(
      'Artist albums request failed: Spotify albums timeout',
    );
  });

  it('uses unknown error messaging when artist album fetch throws a non-Error value', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockRejectedValue('timeout');

    await expect(runSync('user1', 'full')).rejects.toThrow(
      'Artist albums request failed: Unknown error',
    );

    const lastSyncStatusCall = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastSyncStatusCall.errorMessage).toBe('Artist albums request failed: Unknown error');
  });

  it('backs off and continues after a single rate limit, processing remaining artists', async () => {
    getFollowedArtistsMock.mockResolvedValue([
      { id: 'a1', name: 'Artist 1', genres: ['rock'] },
      { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      { id: 'a3', name: 'Artist 3', genres: ['jazz'] },
    ]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock
      .mockRejectedValueOnce(new RetryBudgetExceededError('Retry-After exceeds budget'))
      .mockResolvedValueOnce([makeAlbum('alb2', 'Album 2', '2024-01-01', 'a2', 'Artist 2')])
      .mockResolvedValueOnce([makeAlbum('alb3', 'Album 3', '2024-02-01', 'a3', 'Artist 3')]);

    await runSync('user1', 'full');

    // All 3 artists attempted
    expect(getArtistAlbumsMock).toHaveBeenCalledTimes(3);
    // a2 and a3 releases written
    expect(batchWriteUserReleasesMock).toHaveBeenCalledTimes(2);

    // Sync should complete as done
    const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastStatus.status).toBe('done');

    // 1 artist skipped (a1 rate-limited)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Rate limit exceeded — backing off before next artist',
      expect.objectContaining({ artistId: 'a1', artistName: 'Artist 1', consecutiveRateLimits: 1 }),
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Some artists were skipped during sync',
      expect.objectContaining({ skippedCount: 1, totalArtists: 3 }),
    );

    // Cooldown timestamp must NOT be updated when artists were skipped
    expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'done', undefined);
  });

  it('processes artists before rate limit, backs off, then continues', async () => {
    getFollowedArtistsMock.mockResolvedValue([
      { id: 'a1', name: 'Artist 1', genres: ['rock'] },
      { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      { id: 'a3', name: 'Artist 3', genres: ['jazz'] },
    ]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock
      .mockResolvedValueOnce([makeAlbum('alb1', 'Album 1', '2024-01-01', 'a1', 'Artist 1')])
      .mockRejectedValueOnce(new RetryBudgetExceededError('Retry-After exceeds budget'))
      .mockResolvedValueOnce([makeAlbum('alb3', 'Album 3', '2024-02-01', 'a3', 'Artist 3')]);

    await runSync('user1', 'full');

    // All 3 artists attempted
    expect(getArtistAlbumsMock).toHaveBeenCalledTimes(3);
    // a1 and a3 releases written
    expect(batchWriteUserReleasesMock).toHaveBeenCalledTimes(2);
    const firstReleases = batchWriteUserReleasesMock.mock.calls[0]![1];
    expect(firstReleases[0].artistId).toBe('a1');
    const secondReleases = batchWriteUserReleasesMock.mock.calls[1]![1];
    expect(secondReleases[0].artistId).toBe('a3');

    // Sync should complete as done
    const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastStatus.status).toBe('done');

    // 1 artist skipped (a2 rate-limited)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Some artists were skipped during sync',
      expect.objectContaining({ skippedCount: 1, totalArtists: 3 }),
    );

    // Cooldown timestamp must NOT be updated when artists were skipped
    expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'done', undefined);
  });

  it('aborts after MAX_CONSECUTIVE_RATE_LIMITS consecutive failures', async () => {
    getFollowedArtistsMock.mockResolvedValue([
      { id: 'a1', name: 'Artist 1', genres: ['rock'] },
      { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      { id: 'a3', name: 'Artist 3', genres: ['jazz'] },
      { id: 'a4', name: 'Artist 4', genres: ['metal'] },
      { id: 'a5', name: 'Artist 5', genres: ['folk'] },
    ]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock
      .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'))
      .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'))
      .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'));

    await runSync('user1', 'full');

    // Only 3 Spotify calls made (a1, a2, a3); a4 and a5 never attempted
    expect(getArtistAlbumsMock).toHaveBeenCalledTimes(3);
    expect(batchWriteUserReleasesMock).not.toHaveBeenCalled();

    // Sync should complete as done
    const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastStatus.status).toBe('done');

    // All 5 artists skipped (3 rate-limited + 2 aborted)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Aborting remaining artists after consecutive rate limit failures',
      expect.objectContaining({ consecutiveRateLimits: 3, remainingArtists: 2 }),
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Some artists were skipped during sync',
      expect.objectContaining({ skippedCount: 5, totalArtists: 5 }),
    );

    // Cooldown timestamp must NOT be updated when artists were skipped
    expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'done', undefined);
  });

  it('resets consecutive rate limit counter on successful API call', async () => {
    getFollowedArtistsMock.mockResolvedValue([
      { id: 'a1', name: 'Artist 1', genres: ['rock'] },
      { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      { id: 'a3', name: 'Artist 3', genres: ['jazz'] },
      { id: 'a4', name: 'Artist 4', genres: ['metal'] },
    ]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock
      .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'))
      .mockResolvedValueOnce([makeAlbum('alb2', 'Album 2', '2024-01-01', 'a2', 'Artist 2')])
      .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'))
      .mockResolvedValueOnce([makeAlbum('alb4', 'Album 4', '2024-02-01', 'a4', 'Artist 4')]);

    await runSync('user1', 'full');

    // All 4 artists attempted (counter resets after each success)
    expect(getArtistAlbumsMock).toHaveBeenCalledTimes(4);
    // a2 and a4 releases written
    expect(batchWriteUserReleasesMock).toHaveBeenCalledTimes(2);

    // 2 artists skipped (a1 and a3)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Some artists were skipped during sync',
      expect.objectContaining({ skippedCount: 2, totalArtists: 4 }),
    );

    // Cooldown timestamp must NOT be updated when artists were skipped
    expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'done', undefined);
  });

  it('sleeps RATE_LIMIT_BACKOFF_MS after rate limit before continuing', async () => {
    getFollowedArtistsMock.mockResolvedValue([
      { id: 'a1', name: 'Artist 1', genres: ['rock'] },
      { id: 'a2', name: 'Artist 2', genres: ['pop'] },
    ]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock
      .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'))
      .mockResolvedValueOnce([makeAlbum('alb2', 'Album 2', '2024-01-01', 'a2', 'Artist 2')]);

    await runSync('user1', 'full');

    // Should have slept 30s after the rate limit
    expect(sleepMock).toHaveBeenCalledWith(30_000);
  });

  it('skips artist that returns a 400 from Spotify and completes sync as done', async () => {
    getFollowedArtistsMock.mockResolvedValue([
      { id: 'a1', name: 'Bad Artist', genres: ['rock'] },
      { id: 'a2', name: 'Good Artist', genres: ['pop'] },
    ]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock
      .mockRejectedValueOnce(new AppError(400, 'Spotify API error: 400'))
      .mockResolvedValueOnce([makeAlbum('alb1', 'Album 1', '2024-01-01', 'a2', 'Good Artist')]);

    await runSync('user1', 'full');

    // a1 was skipped — only a2's release written
    expect(batchWriteUserReleasesMock).toHaveBeenCalledOnce();
    const userReleases = batchWriteUserReleasesMock.mock.calls[0]![1];
    expect(userReleases[0].artistId).toBe('a2');

    // Sync should complete as done
    const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastStatus.status).toBe('done');

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Skipping artist due to Spotify client error',
      expect.objectContaining({ artistId: 'a1', artistName: 'Bad Artist', statusCode: 400 }),
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Some artists were skipped during sync',
      expect.objectContaining({ skippedCount: 1, totalArtists: 2 }),
    );

    // Cooldown timestamp must NOT be updated when artists were skipped
    expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'done', undefined);
  });

  it('stores an unknown error message when a non-Error failure happens after Spotify fetches succeed', async () => {
    getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
    getArtistReleasesCachedMock.mockResolvedValue(null);
    getArtistAlbumsMock.mockResolvedValue([
      makeAlbum('alb1', 'Album 1', '2024-03-15', 'a1', 'Artist 1'),
    ]);
    putYearsIndexMock.mockRejectedValue('write failed');

    await expect(runSync('user1', 'full')).rejects.toBe('write failed');

    const lastSyncStatusCall = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastSyncStatusCall.status).toBe('error');
    expect(lastSyncStatusCall.errorMessage).toBe('Unknown error');
  });

  describe('adaptive throttling', () => {
    it('uses 500ms base delay between artist fetches', async () => {
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album 1', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'full');

      expect(sleepMock).toHaveBeenCalledWith(500);
    });

    it('doubles delay after rate limit, then recovers on success', async () => {
      getFollowedArtistsMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
        { id: 'a3', name: 'Artist 3', genres: ['jazz'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock
        .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'))
        .mockResolvedValueOnce([makeAlbum('alb2', 'Album 2', '2024-01-01', 'a2', 'Artist 2')])
        .mockResolvedValueOnce([makeAlbum('alb3', 'Album 3', '2024-02-01', 'a3', 'Artist 3')]);

      await runSync('user1', 'full');

      // After rate limit: delay doubles from 500 to 1000
      // After success on a2: recovers from 1000 to 900, sleep(900)
      const sleepCalls = sleepMock.mock.calls.map((c: unknown[]) => c[0] as number);
      // First sleep is the 30s backoff after rate limit
      expect(sleepCalls[0]).toBe(30_000);
      // Second sleep is the adaptive delay for a2 (doubled to 1000, then recovered to 900)
      expect(sleepCalls[1]).toBe(900);
      // Third sleep is the adaptive delay for a3 (recovered from 900 to 800)
      expect(sleepCalls[2]).toBe(800);
    });

    it('caps adaptive delay at MAX_ARTIST_REQUEST_DELAY_MS (3000ms)', async () => {
      getFollowedArtistsMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
        { id: 'a3', name: 'Artist 3', genres: ['jazz'] },
        { id: 'a4', name: 'Artist 4', genres: ['metal'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      // Three consecutive rate limits (500 -> 1000 -> 2000 -> capped at 3000)
      // then a success
      getArtistAlbumsMock
        .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'))
        .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'))
        .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'));

      await runSync('user1', 'full');

      // Aborted after 3 consecutive rate limits
      // Delay evolution: 500 -> 1000 (rate limit) -> 2000 (rate limit) -> 3000 capped (rate limit)
      // Sleep calls: 30_000 (backoff), 30_000 (backoff), no third backoff because abort
      const sleepCalls = sleepMock.mock.calls.map((c: unknown[]) => c[0] as number);
      expect(sleepCalls).toEqual([30_000, 30_000]);
    });

    it('never drops delay below base 500ms during recovery', async () => {
      getFollowedArtistsMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock
        .mockResolvedValueOnce([makeAlbum('alb1', 'Album 1', '2024-01-01', 'a1', 'Artist 1')])
        .mockResolvedValueOnce([makeAlbum('alb2', 'Album 2', '2024-01-01', 'a2', 'Artist 2')]);

      await runSync('user1', 'full');

      // Both should use base delay of 500ms (no rate limit to increase it)
      const sleepCalls = sleepMock.mock.calls.map((c: unknown[]) => c[0] as number);
      expect(sleepCalls).toEqual([500, 500]);
    });
  });

  describe('chunked sync (deadline & continuation)', () => {
    it('returns SyncContinuation when deadline is exceeded', async () => {
      getFollowedArtistsMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album 1', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      // Set deadline in the past so it triggers immediately after the first artist
      const result = await runSync('user1', 'full', { deadlineMs: 0 });

      expect(result).toBeDefined();
      const continuation = result as SyncContinuation;
      expect(continuation.artistIndex).toBe(0);
      expect(continuation.skippedCount).toBe(0);
      expect(continuation.startedAt).toEqual(expect.any(Number));
      expect(continuation.accumulatedYears).toEqual([]);
      expect(continuation.accumulatedGenres).toEqual([]);
      expect(continuation.currentDelay).toBe(500);

      // Should NOT write years/genres index or set sync to done
      expect(putYearsIndexMock).not.toHaveBeenCalled();
      expect(putGenresIndexMock).not.toHaveBeenCalled();
      const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
      expect(lastStatus.status).toBe('running');
    });

    it('returns undefined when sync completes within deadline', async () => {
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album 1', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      // Far future deadline
      const result = await runSync('user1', 'full', { deadlineMs: Date.now() + 60_000 });

      expect(result).toBeUndefined();
      const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
      expect(lastStatus.status).toBe('done');
    });

    it('resumes from correct artist index when resumeState provided', async () => {
      // Set up artists index (simulating prior chunk already persisted)
      getArtistsIndexMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
        { id: 'a3', name: 'Artist 3', genres: ['jazz'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      // Only a3 will be fetched (a1 and a2 were processed in prior chunk)
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb3', 'Album 3', '2024-06-01', 'a3', 'Artist 3'),
      ]);

      const resumeState: SyncContinuation = {
        artistIndex: 2,
        skippedCount: 0,
        startedAt: Date.now() - 600_000,
        accumulatedYears: ['2024'],
        accumulatedGenres: ['rock', 'pop'],
        currentDelay: 500,
      };

      const result = await runSync('user1', 'full', { resumeState });

      expect(result).toBeUndefined();

      // Should NOT call getFollowedArtists (uses index for resumed full sync)
      expect(getFollowedArtistsMock).not.toHaveBeenCalled();
      // Should read from artists index instead
      expect(getArtistsIndexMock).toHaveBeenCalledWith('user1');

      // Should only fetch albums for a3 (index 2)
      expect(getArtistAlbumsMock).toHaveBeenCalledTimes(1);

      // Should NOT set initial running status (already running)
      const firstPutStatus = putSyncStatusMock.mock.calls[0]![1];
      expect(firstPutStatus.processedArtists).toBe(2); // starts from 2

      // Should merge accumulated years with new years
      const yearsArg = putYearsIndexMock.mock.calls[0]![1] as string[];
      expect(yearsArg).toContain('2024');

      // Should merge accumulated genres with new genres
      const genresArg = putGenresIndexMock.mock.calls[0]![1] as string[];
      expect(genresArg).toContain('rock');
      expect(genresArg).toContain('pop');
      expect(genresArg).toContain('jazz');
    });

    it('does not set initial running status when resuming', async () => {
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([]);

      const resumeState: SyncContinuation = {
        artistIndex: 0,
        skippedCount: 0,
        startedAt: Date.now() - 60_000,
        accumulatedYears: [],
        accumulatedGenres: [],
        currentDelay: 500,
      };

      await runSync('user1', 'full', { resumeState });

      // updateSyncStatus should NOT be called with 'running' (that's the initial call)
      const runningCalls = updateSyncStatusMock.mock.calls.filter(
        (c: unknown[]) => c[1] === 'running',
      );
      expect(runningCalls).toHaveLength(0);
    });

    it('preserves adaptive delay across chunks', async () => {
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album 1', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      const resumeState: SyncContinuation = {
        artistIndex: 0,
        skippedCount: 0,
        startedAt: Date.now() - 60_000,
        accumulatedYears: [],
        accumulatedGenres: [],
        currentDelay: 1500, // elevated from prior rate limits
      };

      await runSync('user1', 'full', { resumeState });

      // Should use the preserved delay (1500 - 100 recovery = 1400)
      expect(sleepMock).toHaveBeenCalledWith(1400);
    });

    it('resumes with requestCount from prior chunk', async () => {
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album 1', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      const resumeState: SyncContinuation = {
        artistIndex: 0,
        skippedCount: 0,
        startedAt: Date.now() - 60_000,
        accumulatedYears: [],
        accumulatedGenres: [],
        currentDelay: 500,
        requestCount: 50,
      };

      await runSync('user1', 'full', { resumeState });

      // Should complete — requestCount 50 + 1 (from the fetch) is under 120 budget
      const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
      expect(lastStatus.status).toBe('done');
    });

    it('re-reads existing album IDs on resume to include prior chunk writes', async () => {
      // Simulate prior chunk having written alb1
      getUserExistingAlbumIdsMock.mockResolvedValue(new Set(['alb1']));
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Already Written', '2024-01-01', 'a1', 'Artist 1'),
        makeAlbum('alb2', 'New Album', '2024-06-01', 'a1', 'Artist 1'),
      ]);

      const resumeState: SyncContinuation = {
        artistIndex: 0,
        skippedCount: 0,
        startedAt: Date.now() - 60_000,
        accumulatedYears: [],
        accumulatedGenres: [],
        currentDelay: 500,
      };

      await runSync('user1', 'full', { resumeState });

      // Only alb2 should be written (alb1 already exists from prior chunk)
      expect(batchWriteUserReleasesMock).toHaveBeenCalledOnce();
      const userReleases = batchWriteUserReleasesMock.mock.calls[0]![1];
      expect(userReleases).toHaveLength(1);
      expect(userReleases[0].albumId).toBe('alb2');
    });

    it('includes requestCount in continuation when deadline is reached', async () => {
      getFollowedArtistsMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album 1', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      const result = await runSync('user1', 'full', { deadlineMs: 0 });

      expect(result).toBeDefined();
      const continuation = result as SyncContinuation;
      expect(continuation.requestCount).toBe(0);
    });

    it('preserves startedAt from resumeState across the entire sync', async () => {
      const originalStartedAt = Date.now() - 600_000;
      getArtistsIndexMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([]);

      const resumeState: SyncContinuation = {
        artistIndex: 0,
        skippedCount: 0,
        startedAt: originalStartedAt,
        accumulatedYears: [],
        accumulatedGenres: [],
        currentDelay: 500,
      };

      await runSync('user1', 'full', { resumeState });

      // All putSyncStatus calls should use the original startedAt
      for (const call of putSyncStatusMock.mock.calls) {
        expect((call as [string, { startedAt: number }])[1].startedAt).toBe(originalStartedAt);
      }
    });
  });

  describe('long rate limit pause', () => {
    it('pauses sync immediately when retryAfterSeconds exceeds threshold', async () => {
      getFollowedArtistsMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockRejectedValueOnce(
        new RetryBudgetExceededError('budget exceeded', 86294),
      );

      const result = await runSync('user1', 'full');

      expect(result).toBeDefined();
      const continuation = result as SyncContinuation;
      expect(continuation.pausedUntil).toBeDefined();
      expect(continuation.pausedUntil).toBeGreaterThan(Date.now());
      expect(continuation.artistIndex).toBe(0);
      expect(continuation.requestCount).toBe(0);

      // Should NOT attempt more artists after long rate limit
      expect(getArtistAlbumsMock).toHaveBeenCalledTimes(1);

      // Should persist paused status
      const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
      expect(lastStatus.status).toBe('paused');
      expect(lastStatus.resumeAfter).toBeDefined();
      expect(lastStatus.continuation).toBeDefined();

      // Should update user sync status to paused
      expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'paused');
    });

    it('does not pause for short rate limits (retryAfterSeconds <= threshold)', async () => {
      getFollowedArtistsMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock
        .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded', 30))
        .mockResolvedValueOnce([makeAlbum('alb2', 'Album 2', '2024-01-01', 'a2', 'Artist 2')]);

      const result = await runSync('user1', 'full');

      // Short rate limit — should complete (skip+continue), not pause
      expect(result).toBeUndefined();
      const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
      expect(lastStatus.status).toBe('done');
    });

    it('does not pause when retryAfterSeconds is undefined', async () => {
      getFollowedArtistsMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock
        .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded'))
        .mockResolvedValueOnce([makeAlbum('alb2', 'Album 2', '2024-01-01', 'a2', 'Artist 2')]);

      const result = await runSync('user1', 'full');

      expect(result).toBeUndefined();
      const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
      expect(lastStatus.status).toBe('done');
    });

    it('preserves accumulated years and genres when pausing', async () => {
      getFollowedArtistsMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock
        .mockResolvedValueOnce([makeAlbum('alb1', 'Album 1', '2024-01-01', 'a1', 'Artist 1')])
        .mockRejectedValueOnce(new RetryBudgetExceededError('budget exceeded', 86294));

      const result = await runSync('user1', 'full');

      expect(result).toBeDefined();
      const continuation = result as SyncContinuation;
      expect(continuation.artistIndex).toBe(1);
      expect(continuation.accumulatedYears).toContain('2024');
      expect(continuation.accumulatedGenres).toContain('rock');
    });
  });

  describe('proactive request budgeting', () => {
    it('pauses when request budget is reached before hitting rate limit', async () => {
      getArtistsIndexMock.mockResolvedValue([
        { id: 'a1', name: 'Artist 1', genres: ['rock'] },
        { id: 'a2', name: 'Artist 2', genres: ['pop'] },
      ]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      // Resume with requestCount already at budget
      const resumeState: SyncContinuation = {
        artistIndex: 0,
        skippedCount: 0,
        startedAt: Date.now() - 60_000,
        accumulatedYears: [],
        accumulatedGenres: [],
        currentDelay: 500,
        requestCount: 120,
      };

      const result = await runSync('user1', 'full', { resumeState });

      expect(result).toBeDefined();
      const continuation = result as SyncContinuation;
      expect(continuation.pausedUntil).toBeDefined();
      expect(continuation.requestCount).toBe(0); // reset for next chunk

      // Should NOT fetch any artists (budget already exceeded)
      expect(getArtistAlbumsMock).not.toHaveBeenCalled();

      const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
      expect(lastStatus.status).toBe('paused');
      expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'paused');
    });

    it('does not pause when request count is under budget', async () => {
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Album', '2024-01-01', 'a1', 'Artist 1'),
      ]);

      const result = await runSync('user1', 'full');

      expect(result).toBeUndefined();
      const lastStatus = putSyncStatusMock.mock.calls.at(-1)![1];
      expect(lastStatus.status).toBe('done');
    });
  });
});
