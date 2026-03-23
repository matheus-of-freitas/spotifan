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

const { gotPostMock, gotGetMock } = vi.hoisted(() => {
  const gotPostMock = vi.fn();
  const gotGetMock = vi.fn();
  return { gotPostMock, gotGetMock };
});

const { loggerMock, createChildLoggerMock, getContextLoggerMock, logUnknownErrorMock } = vi.hoisted(
  () => ({
    loggerMock: {
      info: vi.fn(),
      error: vi.fn(),
      appendKeys: vi.fn(),
      addContext: vi.fn(),
    },
    createChildLoggerMock: vi.fn(),
    getContextLoggerMock: vi.fn(),
    logUnknownErrorMock: vi.fn(),
  }),
);

vi.mock('got', () => ({
  default: {
    post: gotPostMock,
    get: gotGetMock,
  },
}));

vi.mock('../../lib/logger.js', () => ({
  logger: loggerMock,
  createChildLogger: createChildLoggerMock,
  getContextLogger: getContextLoggerMock,
  logUnknownError: logUnknownErrorMock,
}));

import { handleLogin, handleCallback, handleLogout, handleMe } from '../auth.js';
import { clearConfigCache } from '../../lib/config.js';

import { AppError } from '../../lib/errors.js';
import type { HonoEnv } from '../../lib/honoTypes.js';

function createApp() {
  const app = new Hono<HonoEnv>();

  app.use('/api/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const publicPaths = ['/api/auth/login', '/api/auth/callback'];
    if (publicPaths.includes(path)) return next();
    const isLocal = process.env['IS_LOCAL'] === 'true';
    const cookieName = isLocal ? 'session' : '__Host-session';
    const spotifyId = getCookie(c, cookieName);
    if (!spotifyId) return c.json({ error: 'Unauthorized' }, 401);
    c.set('spotifyId', spotifyId);
    return next();
  });

  app.get('/api/auth/login', handleLogin);
  app.get('/api/auth/callback', handleCallback);
  app.post('/api/auth/logout', handleLogout);
  app.get('/api/auth/me', handleMe);
  return app;
}

describe('auth handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createChildLoggerMock.mockReturnValue(loggerMock);
    getContextLoggerMock.mockReturnValue(loggerMock);
    clearConfigCache();
    process.env['IS_LOCAL'] = 'true';
    process.env['COOKIE_SECRET'] = 'test-secret-for-encryption-key!!';
    process.env['SPOTIFY_CLIENT_ID'] = 'test-client-id';
    process.env['TABLE_NAME'] = 'spotifan-test';
  });

  describe('GET /api/auth/login', () => {
    it('redirects to Spotify authorize URL', async () => {
      sendMock.mockResolvedValueOnce({}); // storePkceState

      const app = createApp();
      const res = await app.request('/api/auth/login');

      expect(res.status).toBe(302);
      const location = res.headers.get('location')!;
      expect(location).toContain('https://accounts.spotify.com/authorize');
      expect(location).toContain('client_id=test-client-id');
      expect(location).toContain('code_challenge_method=S256');
      expect(location).toContain('user-follow-read');
    });

    it('uses BASE_URL for redirect URI when set', async () => {
      process.env['BASE_URL'] = 'https://example.cloudfront.net';
      sendMock.mockResolvedValueOnce({}); // storePkceState

      const app = createApp();
      const res = await app.request('/api/auth/login');

      const location = res.headers.get('location')!;
      expect(location).toContain(
        'redirect_uri=' + encodeURIComponent('https://example.cloudfront.net/api/auth/callback'),
      );
      delete process.env['BASE_URL'];
    });
  });

  describe('GET /api/auth/callback', () => {
    it('returns 400 when error param present', async () => {
      const app = createApp();
      app.onError((err, c) => {
        if ('statusCode' in err) {
          return c.json(
            { error: err.message },
            { status: (err as AppError).statusCode as ContentfulStatusCode },
          );
        }
        return c.json({ error: 'Internal' }, 500);
      });

      const res = await app.request('/api/auth/callback?error=access_denied');
      expect(res.status).toBe(400);
    });

    it('returns 400 when code or state missing', async () => {
      const app = createApp();
      app.onError((err, c) => {
        if ('statusCode' in err) {
          return c.json(
            { error: err.message },
            { status: (err as AppError).statusCode as ContentfulStatusCode },
          );
        }
        return c.json({ error: 'Internal' }, 500);
      });

      const res = await app.request('/api/auth/callback?code=abc');
      expect(res.status).toBe(400);
    });

    it('returns 400 when state is invalid', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined }); // consumePkceState returns null

      const app = createApp();
      app.onError((err, c) => {
        if ('statusCode' in err) {
          return c.json(
            { error: err.message },
            { status: (err as AppError).statusCode as ContentfulStatusCode },
          );
        }
        return c.json({ error: 'Internal' }, 500);
      });

      const res = await app.request('/api/auth/callback?code=abc&state=invalid');
      expect(res.status).toBe(400);
    });

    it('exchanges code, creates user, sets cookie, redirects', async () => {
      // consumePkceState: get + delete
      sendMock
        .mockResolvedValueOnce({ Item: { verifier: 'test-verifier' } }) // get
        .mockResolvedValueOnce({}) // delete
        .mockResolvedValueOnce({ Item: undefined }) // getUser (no existing)
        .mockResolvedValueOnce({}); // putUser

      gotPostMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          id: 'spotify-user-1',
          display_name: 'Test User',
          email: 'test@example.com',
          country: 'US',
          images: [{ url: 'https://img.spotify.com/avatar.jpg' }],
        }),
      });

      const app = createApp();
      const res = await app.request('/api/auth/callback?code=auth-code&state=valid-state');

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
      const setCookieHeader = res.headers.get('set-cookie')!;
      expect(setCookieHeader).toContain('session=spotify-user-1');
      expect(setCookieHeader).toContain('HttpOnly');
      expect(setCookieHeader).toContain('Max-Age=2592000');

      // Verify putUser received country
      const putCall = sendMock.mock.calls[3]![0];
      expect(putCall.input.Item.country).toBe('US');
    });

    it('uses __Host-session with Secure when IS_LOCAL is not set', async () => {
      // Prime config cache while IS_LOCAL is true, then switch to prod mode
      const { getConfig } = await import('../../lib/config.js');
      await getConfig();
      process.env['IS_LOCAL'] = 'false';

      sendMock
        .mockResolvedValueOnce({ Item: { verifier: 'test-verifier' } })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({});

      gotPostMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          id: 'spotify-user-1',
          display_name: 'Test User',
          email: 'test@example.com',
          country: 'US',
          images: [{ url: 'https://img.spotify.com/avatar.jpg' }],
        }),
      });

      const app = createApp();
      const res = await app.request('/api/auth/callback?code=auth-code&state=valid-state');

      expect(res.status).toBe(302);
      const setCookieHeader = res.headers.get('set-cookie')!;
      expect(setCookieHeader).toContain('__Host-session=spotify-user-1');
      expect(setCookieHeader).toContain('Secure');
    });

    it('handles missing refresh_token in Spotify response', async () => {
      sendMock
        .mockResolvedValueOnce({ Item: { verifier: 'v' } }) // get pkce
        .mockResolvedValueOnce({}) // delete pkce
        .mockResolvedValueOnce({ Item: undefined }) // getUser
        .mockResolvedValueOnce({}); // putUser

      gotPostMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          access_token: 'test-access',
          expires_in: 3600,
          token_type: 'Bearer',
          // no refresh_token
        }),
      });

      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          id: 'user-no-refresh',
          display_name: 'User',
          email: 'u@e.com',
          country: 'BR',
          images: [{ url: 'https://img.spotify.com/pic.jpg' }],
        }),
      });

      const app = createApp();
      const res = await app.request('/api/auth/callback?code=c&state=s');

      expect(res.status).toBe(302);
      // Verify putUser was called with encrypted empty string for refresh token
      const putCall = sendMock.mock.calls[3]![0];
      expect(putCall.input.Item.encryptedRefreshToken).toBeTruthy();
      expect(putCall.input.Item.spotifyId).toBe('user-no-refresh');
    });

    it('returns 500 when fetching the Spotify profile fails', async () => {
      sendMock.mockResolvedValueOnce({ Item: { verifier: 'v' } }).mockResolvedValueOnce({});

      gotPostMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      gotGetMock.mockReturnValue({
        json: vi.fn().mockRejectedValue(new Error('Spotify profile failed')),
      });

      const app = createApp();
      const res = await app.request('/api/auth/callback?code=c&state=s');

      expect(res.status).toBe(500);
      expect(logUnknownErrorMock).toHaveBeenCalled();
    });

    it('preserves existing user sync status on re-login', async () => {
      sendMock
        .mockResolvedValueOnce({ Item: { verifier: 'v' } }) // get pkce
        .mockResolvedValueOnce({}) // delete pkce
        .mockResolvedValueOnce({
          Item: {
            spotifyId: 'user1',
            syncStatus: 'done',
            lastQuickSyncAt: 1700000000000,
            lastFullSyncAt: 1699000000000,
          },
        }) // getUser
        .mockResolvedValueOnce({}); // putUser

      gotPostMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          id: 'user1',
          display_name: 'User',
          email: 'u@e.com',
          country: 'GB',
          images: [],
        }),
      });

      const app = createApp();
      app.onError((err, c) => {
        if (err instanceof AppError) {
          return c.json({ error: err.message }, { status: err.statusCode as ContentfulStatusCode });
        }
        return c.json({ error: 'Internal' }, 500);
      });
      await app.request('/api/auth/callback?code=c&state=s');

      // Verify putUser preserved sync status
      const putCall = sendMock.mock.calls[3]![0];
      expect(putCall.input.Item.syncStatus).toBe('done');
      expect(putCall.input.Item.lastQuickSyncAt).toBe(1700000000000);
      expect(putCall.input.Item.lastFullSyncAt).toBe(1699000000000);
      // imageUrl should be undefined when images is empty
      expect(putCall.input.Item.imageUrl).toBeUndefined();
      // country should come from profile
      expect(putCall.input.Item.country).toBe('GB');
    });

    it('falls back to existing user country when profile country is missing', async () => {
      sendMock
        .mockResolvedValueOnce({ Item: { verifier: 'v' } }) // get pkce
        .mockResolvedValueOnce({}) // delete pkce
        .mockResolvedValueOnce({
          Item: {
            spotifyId: 'user1',
            syncStatus: 'idle',
            country: 'DE',
          },
        }) // getUser with existing country
        .mockResolvedValueOnce({}); // putUser

      gotPostMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      gotGetMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          id: 'user1',
          display_name: 'User',
          email: 'u@e.com',
          // no country field in profile
          images: [],
        }),
      });

      const app = createApp();
      await app.request('/api/auth/callback?code=c&state=s');

      const putCall = sendMock.mock.calls[3]![0];
      // Should fall back to existing country
      expect(putCall.input.Item.country).toBe('DE');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears session cookie', async () => {
      const app = createApp();
      const res = await app.request('/api/auth/logout', {
        method: 'POST',
        headers: { cookie: 'session=user1' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      const setCookie = res.headers.get('set-cookie')!;
      expect(setCookie).toContain('Max-Age=0');
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without session cookie', async () => {
      const app = createApp();
      const res = await app.request('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns user profile when authenticated', async () => {
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          displayName: 'Test User',
          email: 'test@example.com',
          imageUrl: 'https://img.spotify.com/avatar.jpg',
          syncStatus: 'idle',
          lastQuickSyncAt: 1700000000000,
          lastFullSyncAt: 1699000000000,
          encryptedRefreshToken: 'encrypted',
          encryptedAccessToken: 'encrypted',
          tokenExpiresAt: Date.now() + 3600000,
        },
      });

      const app = createApp();
      const res = await app.request('/api/auth/me', {
        headers: { cookie: 'session=user1' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        spotifyId: 'user1',
        displayName: 'Test User',
        email: 'test@example.com',
        imageUrl: 'https://img.spotify.com/avatar.jpg',
        syncStatus: 'idle',
        lastQuickSyncAt: 1700000000000,
        lastFullSyncAt: 1699000000000,
      });
    });

    it('returns 401 and clears cookie when user not in DB', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });

      const app = createApp();
      app.onError((err, c) => {
        if ('statusCode' in err) {
          return c.json(
            { error: err.message },
            { status: (err as AppError).statusCode as ContentfulStatusCode },
          );
        }
        return c.json({ error: 'Internal' }, 500);
      });

      const res = await app.request('/api/auth/me', {
        headers: { cookie: 'session=nonexistent' },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Not authenticated' });
      // Cookie should be cleared
      const setCookieHeader = res.headers.get('set-cookie')!;
      expect(setCookieHeader).toContain('session=');
      expect(setCookieHeader).toContain('Max-Age=0');
    });
  });
});
