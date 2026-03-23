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

const { loggerMock, getContextLoggerMock, logUnknownErrorMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    error: vi.fn(),
    appendKeys: vi.fn(),
    addContext: vi.fn(),
  },
  getContextLoggerMock: vi.fn(),
  logUnknownErrorMock: vi.fn(),
}));

vi.mock('../../services/syncService.js', () => ({
  runSync: runSyncMock,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: loggerMock,
  getContextLogger: getContextLoggerMock,
  logUnknownError: logUnknownErrorMock,
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
    getContextLoggerMock.mockReturnValue(loggerMock);
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

    it('returns 429 when quick sync cooldown not elapsed', async () => {
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'done',
          lastFullSyncAt: Date.now() - 100_000_000,
          lastQuickSyncAt: Date.now() - 1000, // synced 1 second ago
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
      expect(body.error).toContain('quick');
    });

    it('returns 429 when full sync cooldown not elapsed', async () => {
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'done',
          lastFullSyncAt: Date.now() - 1000, // synced 1 second ago
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync?type=full', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(429);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('7 days');
      expect(body.error).toContain('full');
    });

    it('returns 409 when sync is recently running', async () => {
      // getUser returns running
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'running',
          lastQuickSyncAt: Date.now() - 100000000, // long ago
          lastFullSyncAt: Date.now() - 100000000,
        },
      });
      // getSyncStatus returns recently started sync
      sendMock.mockResolvedValueOnce({
        Item: {
          status: 'running',
          syncType: 'quick',
          totalArtists: 10,
          processedArtists: 3,
          startedAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago
          updatedAt: Date.now(),
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(409);
    });

    it('auto-resets stale sync older than 20 minutes', async () => {
      runSyncMock.mockResolvedValue(undefined);
      // getUser returns running
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'running',
          lastQuickSyncAt: Date.now() - 100000000,
          lastFullSyncAt: Date.now() - 100000000,
        },
      });
      // getSyncStatus returns stale sync (last updated 25 min ago)
      sendMock.mockResolvedValueOnce({
        Item: {
          status: 'running',
          syncType: 'quick',
          totalArtists: 10,
          processedArtists: 3,
          startedAt: Date.now() - 30 * 60 * 1000, // 30 minutes ago
          updatedAt: Date.now() - 25 * 60 * 1000, // 25 minutes ago
        },
      });
      // updateSyncStatus (reset user metadata to error)
      sendMock.mockResolvedValueOnce({});
      // putSyncStatus (reset SYNC#CURRENT to error)
      sendMock.mockResolvedValueOnce({});

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
    });

    it('auto-resets stale sync when no sync status exists', async () => {
      runSyncMock.mockResolvedValue(undefined);
      // getUser returns running
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'running',
          lastQuickSyncAt: Date.now() - 100000000,
          lastFullSyncAt: Date.now() - 100000000,
        },
      });
      // getSyncStatus returns null (no SYNC#CURRENT item)
      sendMock.mockResolvedValueOnce({ Item: undefined });
      // updateSyncStatus (reset to error)
      sendMock.mockResolvedValueOnce({});

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
    });

    it('returns 400 when quick sync requested before any full sync', async () => {
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
          // no lastFullSyncAt
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('full_sync_required');
    });

    it('allows quick sync when lastFullSyncAt is set', async () => {
      runSyncMock.mockResolvedValue(undefined);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
          lastFullSyncAt: Date.now() - 100_000_000,
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
      expect(runSyncMock).toHaveBeenCalledWith('user1', 'quick');
    });

    it('starts quick sync locally when no SYNC_WORKER_FUNCTION_NAME', async () => {
      runSyncMock.mockResolvedValue(undefined);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
          lastFullSyncAt: Date.now() - 100_000_000,
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
      expect(runSyncMock).toHaveBeenCalledWith('user1', 'quick');
    });

    it('starts full sync locally when type=full', async () => {
      runSyncMock.mockResolvedValue(undefined);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync?type=full', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
      expect(runSyncMock).toHaveBeenCalledWith('user1', 'full');
    });

    it('defaults to quick sync when type param is invalid', async () => {
      runSyncMock.mockResolvedValue(undefined);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
          lastFullSyncAt: Date.now() - 100_000_000,
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync?type=invalid', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
      expect(runSyncMock).toHaveBeenCalledWith('user1', 'quick');
    });

    it('invokes Lambda with syncType when SYNC_WORKER_FUNCTION_NAME is set', async () => {
      process.env['SYNC_WORKER_FUNCTION_NAME'] = 'spotifan-sync-worker';
      lambdaSendMock.mockResolvedValue({});
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync?type=full', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
      expect(lambdaSendMock).toHaveBeenCalledOnce();
      expect(runSyncMock).not.toHaveBeenCalled();
    });

    it('allows quick sync when user has no lastQuickSyncAt', async () => {
      runSyncMock.mockResolvedValue(undefined);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
          lastFullSyncAt: Date.now() - 100_000_000,
          // no lastQuickSyncAt
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
    });

    it('allows full sync when user has no lastFullSyncAt', async () => {
      runSyncMock.mockResolvedValue(undefined);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
          // no lastFullSyncAt
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync?type=full', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
    });

    it('handles local sync failure gracefully (logs but does not crash)', async () => {
      runSyncMock.mockRejectedValue(new Error('Sync failed'));
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
          lastFullSyncAt: Date.now() - 100_000_000,
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
      expect(logUnknownErrorMock).toHaveBeenCalled();
    });

    it('allows quick sync when only full sync cooldown is active', async () => {
      runSyncMock.mockResolvedValue(undefined);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          syncStatus: 'idle',
          lastFullSyncAt: Date.now() - 1000, // full sync just happened
          // no lastQuickSyncAt
        },
      });

      const app = createApp();
      const res = await app.request('/api/sync', {
        method: 'POST',
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(202);
    });
  });

  describe('GET /api/sync/status', () => {
    it('returns idle when no sync status exists', async () => {
      // getSyncStatus (Promise.all[0])
      sendMock.mockResolvedValueOnce({ Item: undefined });
      // getUser (Promise.all[1])
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
        lastFullSyncAt: null,
      });
    });

    it('returns sync status with lastFullSyncAt when available', async () => {
      const lastFullSyncAt = Date.now() - 3_600_000;
      const syncStatus = {
        status: 'running',
        syncType: 'quick',
        totalArtists: 100,
        processedArtists: 42,
        startedAt: Date.now() - 60_000, // 1 minute ago (not stale)
        updatedAt: Date.now(),
      };
      // getSyncStatus
      sendMock.mockResolvedValueOnce({ Item: syncStatus });
      // getUser
      sendMock.mockResolvedValueOnce({ Item: { spotifyId: 'user1', lastFullSyncAt } });

      const app = createApp();
      const res = await app.request('/api/sync/status', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ...syncStatus, lastFullSyncAt });
    });

    it('returns lastFullSyncAt: null when user has no full sync', async () => {
      const syncStatus = {
        status: 'done',
        syncType: 'quick',
        totalArtists: 10,
        processedArtists: 10,
        startedAt: Date.now() - 60_000,
        updatedAt: Date.now(),
      };
      // getSyncStatus
      sendMock.mockResolvedValueOnce({ Item: syncStatus });
      // getUser
      sendMock.mockResolvedValueOnce({ Item: { spotifyId: 'user1' } });

      const app = createApp();
      const res = await app.request('/api/sync/status', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { lastFullSyncAt: unknown };
      expect(body.lastFullSyncAt).toBeNull();
    });

    it('resets stale running sync to error on status poll', async () => {
      const staleStatus = {
        status: 'running',
        syncType: 'quick',
        totalArtists: 100,
        processedArtists: 42,
        startedAt: Date.now() - 30 * 60 * 1000, // 30 minutes ago
        updatedAt: Date.now() - 25 * 60 * 1000, // 25 minutes ago
      };
      const lastFullSyncAt = Date.now() - 86_400_000;
      // getSyncStatus
      sendMock.mockResolvedValueOnce({ Item: staleStatus });
      // getUser
      sendMock.mockResolvedValueOnce({ Item: { spotifyId: 'user1', lastFullSyncAt } });
      // putSyncStatus (reset SYNC#CURRENT)
      sendMock.mockResolvedValueOnce({});
      // updateSyncStatus (reset user metadata)
      sendMock.mockResolvedValueOnce({});

      const app = createApp();
      const res = await app.request('/api/sync/status', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        errorMessage: string;
        lastFullSyncAt: number;
      };
      expect(body.status).toBe('error');
      expect(body.errorMessage).toBe('Sync timed out');
      expect(body.lastFullSyncAt).toBe(lastFullSyncAt);
    });

    it('returns recent running sync without resetting', async () => {
      const recentStatus = {
        status: 'running',
        syncType: 'quick',
        totalArtists: 100,
        processedArtists: 42,
        startedAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago
        updatedAt: Date.now(),
      };
      // getSyncStatus
      sendMock.mockResolvedValueOnce({ Item: recentStatus });
      // getUser
      sendMock.mockResolvedValueOnce({ Item: { spotifyId: 'user1' } });

      const app = createApp();
      const res = await app.request('/api/sync/status', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('running');
      // Should not have called putSyncStatus or updateSyncStatus (only getSyncStatus + getUser)
      expect(sendMock).toHaveBeenCalledTimes(2);
    });
  });
});
