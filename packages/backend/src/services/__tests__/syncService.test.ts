import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getFollowedArtistsMock, getArtistAlbumsMock } = vi.hoisted(() => {
  const getFollowedArtistsMock = vi.fn();
  const getArtistAlbumsMock = vi.fn();
  return { getFollowedArtistsMock, getArtistAlbumsMock };
});

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
} = vi.hoisted(() => ({
  batchWriteUserReleasesMock: vi.fn(),
  batchWriteArtistReleasesMock: vi.fn(),
  getArtistReleasesCachedMock: vi.fn(),
  getUserExistingAlbumIdsMock: vi.fn(),
  getYearsIndexMock: vi.fn(),
  putYearsIndexMock: vi.fn(),
  putGenresIndexMock: vi.fn(),
}));

const { putSyncStatusMock } = vi.hoisted(() => ({
  putSyncStatusMock: vi.fn(),
}));

const { updateSyncStatusMock } = vi.hoisted(() => ({
  updateSyncStatusMock: vi.fn(),
}));

const { loggerMock, createChildLoggerMock, logUnknownErrorMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    error: vi.fn(),
    appendKeys: vi.fn(),
    addContext: vi.fn(),
  },
  createChildLoggerMock: vi.fn(),
  logUnknownErrorMock: vi.fn(),
}));

vi.mock('../spotifyClient.js', () => ({
  getFollowedArtists: getFollowedArtistsMock,
  getArtistAlbums: getArtistAlbumsMock,
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
}));

vi.mock('../../db/sync.js', () => ({
  putSyncStatus: putSyncStatusMock,
}));

vi.mock('../../db/users.js', () => ({
  updateSyncStatus: updateSyncStatusMock,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: loggerMock,
  createChildLogger: createChildLoggerMock,
  logUnknownError: logUnknownErrorMock,
}));

import { runSync } from '../syncService.js';

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
    putSyncStatusMock.mockResolvedValue(undefined);
    updateSyncStatusMock.mockResolvedValue(undefined);
    batchWriteUserReleasesMock.mockResolvedValue(undefined);
    batchWriteArtistReleasesMock.mockResolvedValue(undefined);
    putYearsIndexMock.mockResolvedValue(undefined);
    putGenresIndexMock.mockResolvedValue(undefined);
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

    await expect(runSync('user1', 'full')).rejects.toThrow('API down');

    // Should set error status with syncType
    const lastSyncStatusCall = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastSyncStatusCall.status).toBe('error');
    expect(lastSyncStatusCall.syncType).toBe('full');
    expect(lastSyncStatusCall.errorMessage).toBe('API down');

    expect(updateSyncStatusMock).toHaveBeenCalledWith('user1', 'error');
  });

  it('sets error status with unknown message for non-Error throws', async () => {
    getFollowedArtistsMock.mockRejectedValue('string error');

    await expect(runSync('user1', 'quick')).rejects.toBe('string error');

    const lastSyncStatusCall = putSyncStatusMock.mock.calls.at(-1)![1];
    expect(lastSyncStatusCall.errorMessage).toBe('Unknown error');
    expect(lastSyncStatusCall.syncType).toBe('quick');
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
    it('filters releases to current year only', async () => {
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
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
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
      getArtistReleasesCachedMock.mockResolvedValue(null);
      getArtistAlbumsMock.mockResolvedValue([
        makeAlbum('alb1', 'Current Album', `${currentYear}-06-15`, 'a1', 'Artist 1'),
      ]);

      await runSync('user1', 'quick');

      expect(getArtistAlbumsMock).toHaveBeenCalledWith('access-token', 'a1', {
        stopAfterYear: currentYear,
      });
    });

    it('merges new years into existing years index', async () => {
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
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
      getFollowedArtistsMock.mockResolvedValue([{ id: 'a1', name: 'Artist 1', genres: ['rock'] }]);
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

      expect(getArtistAlbumsMock).toHaveBeenCalledWith('access-token', 'a1', {});
    });
  });
});
