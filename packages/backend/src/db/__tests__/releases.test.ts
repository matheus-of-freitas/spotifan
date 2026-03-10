import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchWriteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const { sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  return { sendMock };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual =
    await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({ send: sendMock }),
    },
  };
});

import {
  batchWriteUserReleases,
  batchWriteArtistReleases,
  getArtistReleasesCached,
  getUserExistingAlbumIds,
  queryUserReleases,
  queryAllUserReleases,
  getYearsIndex,
  putYearsIndex,
  type Release,
} from '../releases.js';

function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    albumId: 'album1',
    title: 'Test Album',
    artistId: 'artist1',
    artistName: 'Test Artist',
    albumType: 'album',
    imageUrl: 'https://img.spotify.com/album1.jpg',
    spotifyUrl: 'https://open.spotify.com/album/album1',
    releaseDate: '2024-01-15',
    year: '2024',
    ...overrides,
  };
}

describe('releases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLE_NAME'] = 'spotifan-test';
  });

  describe('batchWriteUserReleases', () => {
    it('writes releases with correct PK/SK and no TTL', async () => {
      sendMock.mockResolvedValueOnce({});
      const releases = [makeRelease()];

      await batchWriteUserReleases('user1', releases);

      expect(sendMock).toHaveBeenCalledOnce();
      const cmd = sendMock.mock.calls[0]![0] as BatchWriteCommand;
      const items = cmd.input.RequestItems!['spotifan-test']!;
      expect(items).toHaveLength(1);
      expect(items[0]!.PutRequest!.Item!['PK']).toBe('USER#user1');
      expect(items[0]!.PutRequest!.Item!['SK']).toBe('RELEASE#2024#2024-01-15#album1');
      expect(items[0]!.PutRequest!.Item!['ttl']).toBeUndefined();
    });

    it('chunks batches of more than 25 items', async () => {
      sendMock.mockResolvedValue({});
      const releases = Array.from({ length: 30 }, (_, i) => makeRelease({ albumId: `album${i}` }));

      await batchWriteUserReleases('user1', releases);

      expect(sendMock).toHaveBeenCalledTimes(2);
      const cmd1 = sendMock.mock.calls[0]![0] as BatchWriteCommand;
      const cmd2 = sendMock.mock.calls[1]![0] as BatchWriteCommand;
      expect(cmd1.input.RequestItems!['spotifan-test']).toHaveLength(25);
      expect(cmd2.input.RequestItems!['spotifan-test']).toHaveLength(5);
    });

    it('handles empty releases array', async () => {
      await batchWriteUserReleases('user1', []);
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('batchWriteArtistReleases', () => {
    it('writes releases with ARTIST PK', async () => {
      sendMock.mockResolvedValueOnce({});
      const releases = [makeRelease()];

      await batchWriteArtistReleases(releases);

      const cmd = sendMock.mock.calls[0]![0] as BatchWriteCommand;
      const items = cmd.input.RequestItems!['spotifan-test']!;
      expect(items[0]!.PutRequest!.Item!['PK']).toBe('ARTIST#artist1');
      expect(items[0]!.PutRequest!.Item!['SK']).toBe('RELEASE#album1');
    });
  });

  describe('getArtistReleasesCached', () => {
    it('returns releases when cache is fresh', async () => {
      const release = makeRelease();
      sendMock.mockResolvedValueOnce({ Items: [release] });

      const result = await getArtistReleasesCached('artist1');

      expect(result).toEqual([release]);
      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :prefix)');
      expect(cmd.input.FilterExpression).toBe('#ttl > :now');
      expect(cmd.input.ExpressionAttributeNames).toEqual({ '#ttl': 'ttl' });
    });

    it('returns null when no items found', async () => {
      sendMock.mockResolvedValueOnce({ Items: [] });

      const result = await getArtistReleasesCached('artist1');

      expect(result).toBeNull();
    });

    it('returns null when Items is undefined', async () => {
      sendMock.mockResolvedValueOnce({});

      const result = await getArtistReleasesCached('artist1');

      expect(result).toBeNull();
    });
  });

  describe('getUserExistingAlbumIds', () => {
    it('returns album IDs from all pages', async () => {
      sendMock
        .mockResolvedValueOnce({
          Items: [{ albumId: 'a1' }, { albumId: 'a2' }],
          LastEvaluatedKey: { PK: 'USER#user1', SK: 'RELEASE#2024#2024-01-01#a2' },
        })
        .mockResolvedValueOnce({
          Items: [{ albumId: 'a3' }],
          LastEvaluatedKey: undefined,
        });

      const result = await getUserExistingAlbumIds('user1');

      expect(result).toEqual(new Set(['a1', 'a2', 'a3']));
      expect(sendMock).toHaveBeenCalledTimes(2);

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :prefix)');
      expect(cmd.input.ExpressionAttributeValues).toEqual({
        ':pk': 'USER#user1',
        ':prefix': 'RELEASE#',
      });
      expect(cmd.input.ProjectionExpression).toBe('albumId');
    });

    it('returns empty set when no releases exist', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const result = await getUserExistingAlbumIds('user1');

      expect(result).toEqual(new Set());
    });

    it('handles undefined Items', async () => {
      sendMock.mockResolvedValueOnce({ Items: undefined, LastEvaluatedKey: undefined });

      const result = await getUserExistingAlbumIds('user1');

      expect(result).toEqual(new Set());
    });
  });

  describe('queryUserReleases', () => {
    it('queries with default options', async () => {
      sendMock.mockResolvedValueOnce({
        Items: [makeRelease()],
        LastEvaluatedKey: undefined,
      });

      const result = await queryUserReleases('user1', {});

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.ExpressionAttributeValues![':pk']).toBe('USER#user1');
      expect(cmd.input.ExpressionAttributeValues![':prefix']).toBe('RELEASE#');
      expect(cmd.input.Limit).toBe(50);
      expect(cmd.input.ScanIndexForward).toBe(false);
    });

    it('filters by year', async () => {
      sendMock.mockResolvedValueOnce({ Items: [] });

      await queryUserReleases('user1', { year: '2024' });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.ExpressionAttributeValues![':prefix']).toBe('RELEASE#2024');
    });

    it('filters by album type', async () => {
      sendMock.mockResolvedValueOnce({ Items: [] });

      await queryUserReleases('user1', { albumType: 'album' });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.FilterExpression).toBe('albumType = :type');
      expect(cmd.input.ExpressionAttributeValues![':type']).toBe('album');
    });

    it('uses cursor for pagination', async () => {
      sendMock.mockResolvedValueOnce({ Items: [] });
      const cursor = Buffer.from(
        JSON.stringify({ PK: 'USER#user1', SK: 'RELEASE#2024#2024-01-15#album1' }),
      ).toString('base64url');

      await queryUserReleases('user1', { cursor });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.ExclusiveStartKey).toEqual({
        PK: 'USER#user1',
        SK: 'RELEASE#2024#2024-01-15#album1',
      });
    });

    it('returns nextCursor when LastEvaluatedKey present', async () => {
      const lastKey = { PK: 'USER#user1', SK: 'RELEASE#2024#2024-01-15#album1' };
      sendMock.mockResolvedValueOnce({
        Items: [makeRelease()],
        LastEvaluatedKey: lastKey,
      });

      const result = await queryUserReleases('user1', {});

      expect(result.nextCursor).toBeDefined();
      const decoded = JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString('utf8'));
      expect(decoded).toEqual(lastKey);
    });

    it('caps limit at 100', async () => {
      sendMock.mockResolvedValueOnce({ Items: [] });

      await queryUserReleases('user1', { limit: 200 });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.Limit).toBe(100);
    });

    it('returns empty items when no releases exist', async () => {
      sendMock.mockResolvedValueOnce({ Items: undefined });

      const result = await queryUserReleases('user1', {});

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });

    it('filters by date range', async () => {
      sendMock.mockResolvedValueOnce({ Items: [] });

      await queryUserReleases('user1', {
        startDate: '2024-01-01',
        endDate: '2024-06-30',
      });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.FilterExpression).toBe('releaseDate BETWEEN :startDate AND :endDate');
      expect(cmd.input.ExpressionAttributeValues![':startDate']).toBe('2024-01-01');
      expect(cmd.input.ExpressionAttributeValues![':endDate']).toBe('2024-06-30');
    });

    it('combines date range with album type filter', async () => {
      sendMock.mockResolvedValueOnce({ Items: [] });

      await queryUserReleases('user1', {
        albumType: 'album',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.FilterExpression).toBe(
        'albumType = :type AND releaseDate BETWEEN :startDate AND :endDate',
      );
    });

    it('ignores date range when only startDate is provided', async () => {
      sendMock.mockResolvedValueOnce({ Items: [] });

      await queryUserReleases('user1', { startDate: '2024-01-01' });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.FilterExpression).toBeUndefined();
    });

    it('ignores date range when only endDate is provided', async () => {
      sendMock.mockResolvedValueOnce({ Items: [] });

      await queryUserReleases('user1', { endDate: '2024-12-31' });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.FilterExpression).toBeUndefined();
    });
  });

  describe('queryAllUserReleases', () => {
    it('returns all releases across multiple pages', async () => {
      sendMock
        .mockResolvedValueOnce({
          Items: [makeRelease({ albumId: 'a1' }), makeRelease({ albumId: 'a2' })],
          LastEvaluatedKey: { PK: 'USER#user1', SK: 'RELEASE#2024#2024-01-15#a2' },
        })
        .mockResolvedValueOnce({
          Items: [makeRelease({ albumId: 'a3' })],
          LastEvaluatedKey: undefined,
        });

      const result = await queryAllUserReleases('user1', {});

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.albumId)).toEqual(['a1', 'a2', 'a3']);
      expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when no releases exist', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const result = await queryAllUserReleases('user1', {});

      expect(result).toEqual([]);
    });

    it('filters by year', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      await queryAllUserReleases('user1', { year: '2024' });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.ExpressionAttributeValues![':prefix']).toBe('RELEASE#2024');
    });

    it('filters by album type', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      await queryAllUserReleases('user1', { albumType: 'album' });

      const cmd = sendMock.mock.calls[0]![0] as QueryCommand;
      expect(cmd.input.FilterExpression).toBe('albumType = :type');
      expect(cmd.input.ExpressionAttributeValues![':type']).toBe('album');
    });

    it('handles undefined Items', async () => {
      sendMock.mockResolvedValueOnce({ Items: undefined, LastEvaluatedKey: undefined });

      const result = await queryAllUserReleases('user1', {});

      expect(result).toEqual([]);
    });
  });

  describe('getYearsIndex', () => {
    it('returns years when index exists', async () => {
      sendMock.mockResolvedValueOnce({
        Item: { years: ['2024', '2023', '2022'] },
      });

      const result = await getYearsIndex('user1');

      expect(result).toEqual(['2024', '2023', '2022']);
    });

    it('returns empty array when index does not exist', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });

      const result = await getYearsIndex('user1');

      expect(result).toEqual([]);
    });
  });

  describe('putYearsIndex', () => {
    it('writes years with correct PK/SK', async () => {
      sendMock.mockResolvedValueOnce({});

      await putYearsIndex('user1', ['2024', '2023']);

      const cmd = sendMock.mock.calls[0]![0] as PutCommand;
      expect(cmd.input.Item).toEqual({
        PK: 'USER#user1',
        SK: 'YEARS#INDEX',
        years: ['2024', '2023'],
      });
    });
  });
});
