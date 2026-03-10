import got from 'got';
import { getConfig } from '../lib/config.js';
import { encrypt, decrypt, encryptionKeyFromSecret } from '../lib/crypto.js';
import { putUser, getUser } from '../db/users.js';
import { UnauthorizedError } from '../lib/errors.js';

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
  const config = await getConfig();
  return got
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
}

export async function refreshAccessToken(encryptedRefreshToken: string): Promise<{
  accessToken: string;
  encryptedAccessToken: string;
  tokenExpiresAt: number;
  newEncryptedRefreshToken?: string;
}> {
  const config = await getConfig();
  const key = encryptionKeyFromSecret(config.cookieSecret);
  const refreshToken = decrypt(encryptedRefreshToken, key);

  const response = await got
    .post('https://accounts.spotify.com/api/token', {
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.spotifyClientId,
      },
    })
    .json<SpotifyTokenResponse>();

  const tokenExpiresAt = Date.now() + response.expires_in * 1000 - 60000;
  const encryptedAccessToken = encrypt(response.access_token, key);
  const newEncryptedRefreshToken = response.refresh_token
    ? encrypt(response.refresh_token, key)
    : undefined;

  return { accessToken: response.access_token, encryptedAccessToken, tokenExpiresAt, newEncryptedRefreshToken };
}

export async function getValidAccessToken(spotifyId: string): Promise<string> {
  const user = await getUser(spotifyId);
  if (!user) throw new UnauthorizedError('User not found');

  const config = await getConfig();
  const key = encryptionKeyFromSecret(config.cookieSecret);

  if (Date.now() < user.tokenExpiresAt) {
    return decrypt(user.encryptedAccessToken, key);
  }

  const result = await refreshAccessToken(user.encryptedRefreshToken);

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
