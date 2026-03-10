import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

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

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  GetSecretValueCommand: vi.fn(),
}));

const { lambdaSendMock } = vi.hoisted(() => {
  const lambdaSendMock = vi.fn();
  return { lambdaSendMock };
});

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: lambdaSendMock })),
  InvokeCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

const { runSyncMock } = vi.hoisted(() => {
  const runSyncMock = vi.fn();
  return { runSyncMock };
});

vi.mock('../../services/syncService.js', () => ({
  runSync: runSyncMock,
}));

import { handleSync, handleSyncStatus } from '../sync.js';
import { clearConfigCache } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import type { HonoEnv } from '../../lib/honoTypes.js';

function createApp() {
  const app = new Hono<HonoEnv>();

  app.use('/api/*', async (c, next) => {
    const spotifyId = getCookie(c, '__Host-session');
    if (!spotifyId) return c.json({ error: 'Unauthorized' }, 401);
    c.set('spotifyId', spotifyId);
    return next();
  });

  app.post('/api/sync', handleSync);
  app.get('/api/sync/status', handleSyncStatus);

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.message }, { status: err.statusCode as ContentfulStatusCode });
    }
    return c.json({ error: 'Internal' }, 500);
  });

  return app;
}

describe('sync handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearConfigCache();
    process.env['IS_LOCAL'] = 'true';
    process.env['COOKIE_SECRET'] = 'test-secret-for-encryption-key!!';
    process.env['SPOTIFY_CLIENT_ID'] = 'test-client-id';
    process.env['TABLE_NAME'] = 'spotifan-test';
    delete process.env['SYNC_WORKER_FUNCTION_NAME'];
  });

  describe('POST /api/sync', () => {
    it('returns 404 when user not found', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(404);
    });

    it('returns 429 when sync cooldown not elapsed', async () => {
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'done',
          lastSyncedAt: Date.now() - 1000, // synced 1 second ago
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(429);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('24 hours');
    });

    it('returns 409 when sync already running', async () => {
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'running',
          lastSyncedAt: Date.now() - 100000000, // long ago
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(409);
    });

    it('starts sync locally when no SYNC_WORKER_FUNCTION_NAME', async () => {
      runSyncMock.mockResolvedValue(undefined);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(runSyncMock).toHaveBeenCalledWith('user1');
    });

    it('invokes Lambda when SYNC_WORKER_FUNCTION_NAME is set', async () => {
      process.env['SYNC_WORKER_FUNCTION_NAME'] = 'spotifan-sync-worker';
      lambdaSendMock.mockResolvedValue({});
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
      expect(lambdaSendMock).toHaveBeenCalledOnce();
      expect(runSyncMock).not.toHaveBeenCalled();
    });

    it('allows sync when user has no lastSyncedAt', async () => {
      runSyncMock.mockResolvedValue(undefined);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
          // no lastSyncedAt
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
    });

    it('handles local sync failure gracefully (logs but does not crash)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      runSyncMock.mockRejectedValue(new Error('Sync failed'));
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
      // Wait for the async catch to fire
      await new Promise((r) => setTimeout(r, 10));
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('GET /api/sync/status', () => {
    it('returns idle when no sync status exists', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });

      const app = createApp();
      const res = await app.request('/api/sync/status', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        status: 'idle',
        totalArtists: 0,
        processedArtists: 0,
      });
    });

    it('returns sync status when available', async () => {
      const syncStatus = {
        status: 'running',
        totalArtists: 100,
        processedArtists: 42,
        startedAt: 1700000000000,
        updatedAt: 1700000001000,
      };
      sendMock.mockResolvedValueOnce({ Item: syncStatus });

      const app = createApp();
      const res = await app.request('/api/sync/status', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(syncStatus);
    });
  });
});
