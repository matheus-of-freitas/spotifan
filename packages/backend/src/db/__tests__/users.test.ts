import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const { sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  return { sendMock };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>(
    '@aws-sdk/lib-dynamodb',
  );
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({ send: sendMock }),
    },
  };
});

import {
  getUser,
  putUser,
  updateSyncStatus,
  storePkceState,
  consumePkceState,
  type UserMetadata,
} from '../users.js';

const testUser: UserMetadata = {
  spotifyId: 'user123',
  displayName: 'Test User',
  email: 'test@example.com',
  imageUrl: 'https://img.spotify.com/user123.jpg',
  encryptedRefreshToken: 'encrypted-refresh',
  encryptedAccessToken: 'encrypted-access',
  tokenExpiresAt: Date.now() + 3600000,
  syncStatus: 'idle',
  lastSyncedAt: undefined,
};

describe('users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLE_NAME'] = 'spotifan-test';
  });

  describe('getUser', () => {
    it('returns user when found', async () => {
      sendMock.mockResolvedValueOnce({ Item: testUser });

      const result = await getUser('user123');

      expect(result).toEqual(testUser);
      expect(sendMock).toHaveBeenCalledOnce();
      const cmd = sendMock.mock.calls[0]![0] as GetCommand;
      expect(cmd.input).toEqual({
        TableName: 'spotifan-test',
        Key: { PK: 'USER#user123', SK: 'METADATA' },
      });
    });

    it('returns null when user not found', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });

      const result = await getUser('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('putUser', () => {
    it('writes user with correct PK/SK', async () => {
      sendMock.mockResolvedValueOnce({});

      await putUser(testUser);

      expect(sendMock).toHaveBeenCalledOnce();
      const cmd = sendMock.mock.calls[0]![0] as PutCommand;
      expect(cmd.input.Item).toEqual({
        PK: 'USER#user123',
        SK: 'METADATA',
        ...testUser,
      });
    });
  });

  describe('updateSyncStatus', () => {
    it('updates sync status without lastSyncedAt', async () => {
      sendMock.mockResolvedValueOnce({});

      await updateSyncStatus('user123', 'running');

      expect(sendMock).toHaveBeenCalledOnce();
      const cmd = sendMock.mock.calls[0]![0] as UpdateCommand;
      expect(cmd.input.UpdateExpression).toBe('SET syncStatus = :s');
      expect(cmd.input.ExpressionAttributeValues).toEqual({ ':s': 'running' });
    });

    it('updates sync status with lastSyncedAt', async () => {
      sendMock.mockResolvedValueOnce({});
      const now = Date.now();

      await updateSyncStatus('user123', 'done', now);

      const cmd = sendMock.mock.calls[0]![0] as UpdateCommand;
      expect(cmd.input.UpdateExpression).toBe(
        'SET syncStatus = :s, lastSyncedAt = :t',
      );
      expect(cmd.input.ExpressionAttributeValues).toEqual({
        ':s': 'done',
        ':t': now,
      });
    });
  });

  describe('storePkceState', () => {
    it('stores state with verifier and TTL', async () => {
      sendMock.mockResolvedValueOnce({});

      await storePkceState('state123', 'verifier456', 1700000000);

      const cmd = sendMock.mock.calls[0]![0] as PutCommand;
      expect(cmd.input.Item).toEqual({
        PK: 'PKCE#state123',
        SK: 'VERIFIER',
        verifier: 'verifier456',
        ttl: 1700000000,
      });
    });
  });

  describe('consumePkceState', () => {
    it('returns verifier and deletes item', async () => {
      sendMock
        .mockResolvedValueOnce({ Item: { verifier: 'verifier456' } })
        .mockResolvedValueOnce({});

      const result = await consumePkceState('state123');

      expect(result).toBe('verifier456');
      expect(sendMock).toHaveBeenCalledTimes(2);

      // First call: GetCommand
      const getCmd = sendMock.mock.calls[0]![0] as GetCommand;
      expect(getCmd.input.Key).toEqual({
        PK: 'PKCE#state123',
        SK: 'VERIFIER',
      });

      // Second call: DeleteCommand
      const delCmd = sendMock.mock.calls[1]![0] as DeleteCommand;
      expect(delCmd.input.Key).toEqual({
        PK: 'PKCE#state123',
        SK: 'VERIFIER',
      });
    });

    it('returns null when state not found', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });

      const result = await consumePkceState('nonexistent');

      expect(result).toBeNull();
      expect(sendMock).toHaveBeenCalledOnce(); // No delete call
    });
  });
});
