import got from 'got';
import { getConfig } from '../lib/config.js';
import { encrypt, decrypt, encryptionKeyFromSecret } from '../lib/crypto.js';
import { putUser, getUser } from '../db/users.js';
import { UnauthorizedError } from '../lib/errors.js';
import { createChildLogger, logUnknownError } from '../lib/logger.js';

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<SpotifyTokenResponse> {
  const log = createChildLogger({ operation: 'exchangeCodeForTokens' });
  const config = await getConfig();
  log.info('Exchanging authorization code for Spotify tokens');
  try {
    return await got
      .post('https://accounts.spotify.com/api/token', {
        form: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: config.spotifyClientId,
          code_verifier: verifier,
        },
      })
      .json<SpotifyTokenResponse>();
  } catch (error) {
    logUnknownError(log, 'Failed to exchange authorization code for Spotify tokens', error);
    throw error;
  }
}

export async function refreshAccessToken(encryptedRefreshToken: string): Promise<{
  accessToken: string;
  encryptedAccessToken: string;
  tokenExpiresAt: number;
  newEncryptedRefreshToken?: string;
}> {
  const log = createChildLogger({ operation: 'refreshAccessToken' });
  const config = await getConfig();
  const key = encryptionKeyFromSecret(config.cookieSecret);
  const refreshToken = decrypt(encryptedRefreshToken, key);

  log.info('Refreshing Spotify access token');
  let response: SpotifyTokenResponse;
  try {
    response = await got
      .post('https://accounts.spotify.com/api/token', {
        form: {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: config.spotifyClientId,
        },
      })
      .json<SpotifyTokenResponse>();
  } catch (error) {
    logUnknownError(log, 'Failed to refresh Spotify access token', error);
    throw error;
  }

  const tokenExpiresAt = Date.now() + response.expires_in * 1000 - 60000;
  const encryptedAccessToken = encrypt(response.access_token, key);
  const newEncryptedRefreshToken = response.refresh_token
    ? encrypt(response.refresh_token, key)
    : undefined;

  return {
    accessToken: response.access_token,
    encryptedAccessToken,
    tokenExpiresAt,
    newEncryptedRefreshToken,
  };
}

export async function getValidAccessToken(spotifyId: string): Promise<string> {
  const log = createChildLogger({ operation: 'getValidAccessToken', spotifyId });
  const user = await getUser(spotifyId);
  if (!user) {
    log.error('Cannot fetch valid access token because user was not found', { spotifyId });
    throw new UnauthorizedError('User not found');
  }

  const config = await getConfig();
  const key = encryptionKeyFromSecret(config.cookieSecret);

  if (Date.now() < user.tokenExpiresAt) {
    log.info('Using cached Spotify access token', { spotifyId });
    return decrypt(user.encryptedAccessToken, key);
  }

  const result = await refreshAccessToken(user.encryptedRefreshToken);

  log.info('Persisting refreshed Spotify access token', { spotifyId });
  await putUser({
    ...user,
    encryptedAccessToken: result.encryptedAccessToken,
    tokenExpiresAt: result.tokenExpiresAt,
    ...(result.newEncryptedRefreshToken
      ? { encryptedRefreshToken: result.newEncryptedRefreshToken }
      : {}),
  });

  return result.accessToken;
}
