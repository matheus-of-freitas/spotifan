import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

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

import { putSyncStatus, getSyncStatus, type SyncStatus } from '../sync.js';

const testStatus: SyncStatus = {
  status: 'running',
  syncType: 'quick',
  totalArtists: 100,
  processedArtists: 25,
  startedAt: 1700000000000,
  updatedAt: 1700000060000,
};

describe('sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLE_NAME'] = 'spotifan-test';
  });

  describe('putSyncStatus', () => {
    it('writes sync status with correct PK/SK and TTL', async () => {
      sendMock.mockResolvedValueOnce({});

      await putSyncStatus('user1', testStatus);

      expect(sendMock).toHaveBeenCalledOnce();
      const cmd = sendMock.mock.calls[0]![0] as PutCommand;
      expect(cmd.input.Item!['PK']).toBe('USER#user1');
      expect(cmd.input.Item!['SK']).toBe('SYNC#CURRENT');
      expect(cmd.input.Item!['status']).toBe('running');
      expect(cmd.input.Item!['syncType']).toBe('quick');
      expect(cmd.input.Item!['totalArtists']).toBe(100);
      expect(cmd.input.Item!['processedArtists']).toBe(25);
      expect(cmd.input.Item!['ttl']).toBeTypeOf('number');
      // TTL should be approximately 1 hour from now
      const ttl = cmd.input.Item!['ttl'] as number;
      const now = Math.floor(Date.now() / 1000);
      expect(ttl).toBeGreaterThan(now + 3500);
      expect(ttl).toBeLessThanOrEqual(now + 3600);
    });

    it('includes errorMessage when present', async () => {
      sendMock.mockResolvedValueOnce({});
      const errorStatus: SyncStatus = {
        ...testStatus,
        status: 'error',
        errorMessage: 'Rate limited',
      };

      await putSyncStatus('user1', errorStatus);

      const cmd = sendMock.mock.calls[0]![0] as PutCommand;
      expect(cmd.input.Item!['errorMessage']).toBe('Rate limited');
    });

    it('uses extended TTL (~25h) for paused status', async () => {
      sendMock.mockResolvedValueOnce({});
      const pausedStatus: SyncStatus = {
        ...testStatus,
        status: 'paused',
        resumeAfter: Date.now() + 86_294_000,
        continuation: {
          artistIndex: 50,
          skippedCount: 0,
          startedAt: Date.now(),
          accumulatedYears: ['2024'],
          accumulatedGenres: ['rock'],
          currentDelay: 500,
          requestCount: 0,
          pausedUntil: Date.now() + 86_294_000,
        },
      };

      await putSyncStatus('user1', pausedStatus);

      const cmd = sendMock.mock.calls[0]![0] as PutCommand;
      const ttl = cmd.input.Item!['ttl'] as number;
      const now = Math.floor(Date.now() / 1000);
      // TTL should be approximately 25 hours from now (90000 seconds)
      expect(ttl).toBeGreaterThan(now + 89_000);
      expect(ttl).toBeLessThanOrEqual(now + 90_000);
      expect(cmd.input.Item!['status']).toBe('paused');
      expect(cmd.input.Item!['continuation']).toBeDefined();
    });

    it('writes full sync type', async () => {
      sendMock.mockResolvedValueOnce({});
      const fullStatus: SyncStatus = { ...testStatus, syncType: 'full' };

      await putSyncStatus('user1', fullStatus);

      const cmd = sendMock.mock.calls[0]![0] as PutCommand;
      expect(cmd.input.Item!['syncType']).toBe('full');
    });
  });

  describe('getSyncStatus', () => {
    it('returns sync status when found', async () => {
      sendMock.mockResolvedValueOnce({ Item: testStatus });

      const result = await getSyncStatus('user1');

      expect(result).toEqual(testStatus);
      const cmd = sendMock.mock.calls[0]![0] as GetCommand;
      expect(cmd.input.Key).toEqual({
        PK: 'USER#user1',
        SK: 'SYNC#CURRENT',
      });
    });

    it('returns null when no sync status exists', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });

      const result = await getSyncStatus('user1');

      expect(result).toBeNull();
    });
  });
});
