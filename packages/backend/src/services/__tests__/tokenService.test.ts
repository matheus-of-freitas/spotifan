import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encrypt, encryptionKeyFromSecret } from '../../lib/crypto.js';

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

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  GetSecretValueCommand: vi.fn(),
}));

const { gotPostMock } = vi.hoisted(() => {
  const gotPostMock = vi.fn();
  return { gotPostMock };
});

vi.mock('got', () => ({
  default: {
    post: gotPostMock,
  },
}));

import { exchangeCodeForTokens, refreshAccessToken, getValidAccessToken } from '../tokenService.js';
import { clearConfigCache } from '../../lib/config.js';

describe('tokenService', () => {
  const cookieSecret = 'test-secret-for-encryption-key!!';
  const key = encryptionKeyFromSecret(cookieSecret);

  beforeEach(() => {
    vi.clearAllMocks();
    clearConfigCache();
    process.env['IS_LOCAL'] = 'true';
    process.env['COOKIE_SECRET'] = cookieSecret;
    process.env['SPOTIFY_CLIENT_ID'] = 'test-client-id';
    process.env['TABLE_NAME'] = 'spotifan-test';
  });

  describe('exchangeCodeForTokens', () => {
    it('posts to Spotify token endpoint with correct params', async () => {
      const tokenResponse = {
        access_token: 'access123',
        refresh_token: 'refresh123',
        expires_in: 3600,
        token_type: 'Bearer',
      };
      gotPostMock.mockReturnValue({ json: vi.fn().mockResolvedValue(tokenResponse) });

      const result = await exchangeCodeForTokens(
        'code123',
        'verifier123',
        'http://localhost:3000/api/auth/callback',
      );

      expect(gotPostMock).toHaveBeenCalledWith(
        'https://accounts.spotify.com/api/token',
        {
          form: {
            grant_type: 'authorization_code',
            code: 'code123',
            redirect_uri: 'http://localhost:3000/api/auth/callback',
            client_id: 'test-client-id',
            code_verifier: 'verifier123',
          },
        },
      );
      expect(result).toEqual(tokenResponse);
    });
  });

  describe('refreshAccessToken', () => {
    it('decrypts refresh token and posts to Spotify', async () => {
      const encryptedRefresh = encrypt('real-refresh-token', key);
      const tokenResponse = {
        access_token: 'new-access',
        expires_in: 3600,
        token_type: 'Bearer',
      };
      gotPostMock.mockReturnValue({ json: vi.fn().mockResolvedValue(tokenResponse) });

      const result = await refreshAccessToken(encryptedRefresh);

      expect(result.accessToken).toBe('new-access');
      expect(result.encryptedAccessToken).toBeTruthy();
      expect(result.tokenExpiresAt).toBeGreaterThan(Date.now());
      expect(result.newEncryptedRefreshToken).toBeUndefined();
    });

    it('returns new encrypted refresh token when Spotify provides one', async () => {
      const encryptedRefresh = encrypt('old-refresh', key);
      const tokenResponse = {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      };
      gotPostMock.mockReturnValue({ json: vi.fn().mockResolvedValue(tokenResponse) });

      const result = await refreshAccessToken(encryptedRefresh);
      expect(result.newEncryptedRefreshToken).toBeTruthy();
    });
  });

  describe('getValidAccessToken', () => {
    it('returns cached token when not expired', async () => {
      const encryptedAccess = encrypt('cached-token', key);
      sendMock.mockResolvedValueOnce({
        Item: {
          spotifyId: 'user1',
          encryptedAccessToken: encryptedAccess,
          encryptedRefreshToken: encrypt('refresh', key),
          tokenExpiresAt: Date.now() + 3600000,
          displayName: 'Test',
          syncStatus: 'idle',
        },
      });

      const result = await getValidAccessToken('user1');
      expect(result).toBe('cached-token');
      expect(gotPostMock).not.toHaveBeenCalled();
    });

    it('refreshes token when expired', async () => {
      const encryptedRefresh = encrypt('my-refresh', key);
      sendMock
        .mockResolvedValueOnce({
          Item: {
            spotifyId: 'user1',
            encryptedAccessToken: encrypt('old-access', key),
            encryptedRefreshToken: encryptedRefresh,
            tokenExpiresAt: Date.now() - 1000,
            displayName: 'Test',
            syncStatus: 'idle',
          },
        })
        .mockResolvedValueOnce({}); // putUser

      gotPostMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          access_token: 'fresh-access',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const result = await getValidAccessToken('user1');
      expect(result).toBe('fresh-access');
      expect(gotPostMock).toHaveBeenCalledOnce();
      expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('updates refresh token when Spotify provides a new one', async () => {
      const encryptedRefresh = encrypt('old-refresh', key);
      sendMock
        .mockResolvedValueOnce({
          Item: {
            spotifyId: 'user1',
            encryptedAccessToken: encrypt('old-access', key),
            encryptedRefreshToken: encryptedRefresh,
            tokenExpiresAt: Date.now() - 1000,
            displayName: 'Test',
            syncStatus: 'idle',
          },
        })
        .mockResolvedValueOnce({}); // putUser

      gotPostMock.mockReturnValue({
        json: vi.fn().mockResolvedValue({
          access_token: 'fresh-access',
          refresh_token: 'brand-new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const result = await getValidAccessToken('user1');
      expect(result).toBe('fresh-access');

      // Check putUser was called with new encrypted refresh token
      const putCall = sendMock.mock.calls[1]![0];
      expect(putCall.input.Item.encryptedRefreshToken).not.toBe(encryptedRefresh);
    });

    it('throws UnauthorizedError when user not found', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });
      await expect(getValidAccessToken('nonexistent')).rejects.toThrow('User not found');
    });
  });
});
