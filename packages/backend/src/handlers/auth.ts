import type { Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { createHash, randomBytes } from 'node:crypto';
import { getConfig } from '../lib/config.js';
import { storePkceState, consumePkceState, putUser, getUser } from '../db/users.js';
import { exchangeCodeForTokens } from '../services/tokenService.js';
import { encrypt, encryptionKeyFromSecret } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import type { HonoEnv } from '../lib/honoTypes.js';

interface SpotifyProfile {
  id: string;
  display_name: string;
  email: string;
  images: Array<{ url: string }>;
}

function getCookieConfig() {
  const local = process.env['IS_LOCAL'] === 'true';
  return { name: local ? 'session' : '__Host-session', local };
}

function getRedirectUri(c: Context): string {
  const baseUrl = process.env['BASE_URL'];
  if (baseUrl) return `${baseUrl}/api/auth/callback`;
  const host = c.req.header('host') ?? 'localhost:3000';
  const proto = c.req.header('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}/api/auth/callback`;
}

function computeChallenge(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest();
  return Buffer.from(hash).toString('base64url');
}

export async function handleLogin(c: Context<HonoEnv>): Promise<Response> {
  const config = await getConfig();
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = computeChallenge(verifier);

  const ttl = Math.floor(Date.now() / 1000) + 600;
  await storePkceState(state, verifier, ttl);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.spotifyClientId,
    redirect_uri: getRedirectUri(c),
    scope: 'user-follow-read user-read-email user-read-private',
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  return c.redirect(`https://accounts.spotify.com/authorize?${params}`);
}

export async function handleCallback(c: Context<HonoEnv>): Promise<Response> {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) throw new AppError(400, `Spotify auth error: ${error}`);
  if (!code || !state) throw new AppError(400, 'Missing code or state');

  const verifier = await consumePkceState(state);
  if (!verifier) throw new AppError(400, 'Invalid or expired state');

  const config = await getConfig();
  const key = encryptionKeyFromSecret(config.cookieSecret);
  const tokens = await exchangeCodeForTokens(code, verifier, getRedirectUri(c));

  // Fetch Spotify user profile
  const { default: got } = await import('got');
  const profile = await got
    .get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    .json<SpotifyProfile>();

  const existing = await getUser(profile.id);
  await putUser({
    spotifyId: profile.id,
    displayName: profile.display_name,
    email: profile.email,
    imageUrl: profile.images[0]?.url,
    encryptedRefreshToken: encrypt(tokens.refresh_token ?? '', key),
    encryptedAccessToken: encrypt(tokens.access_token, key),
    tokenExpiresAt: Date.now() + tokens.expires_in * 1000 - 60000,
    syncStatus: existing?.syncStatus ?? 'idle',
    lastSyncedAt: existing?.lastSyncedAt,
  });

  const cookie = getCookieConfig();
  setCookie(c, cookie.name, profile.id, {
    httpOnly: true,
    secure: !cookie.local,
    sameSite: 'Lax',
    path: '/',
  });
  return c.redirect('/');
}

export async function handleLogout(c: Context<HonoEnv>): Promise<Response> {
  const cookie = getCookieConfig();
  deleteCookie(c, cookie.name, { path: '/' });
  return c.json({ ok: true });
}

export async function handleMe(c: Context<HonoEnv>): Promise<Response> {
  const spotifyId = c.get('spotifyId');
  const user = await getUser(spotifyId);
  if (!user) throw new AppError(404, 'User not found');
  return c.json({
    spotifyId: user.spotifyId,
    displayName: user.displayName,
    email: user.email,
    imageUrl: user.imageUrl,
    syncStatus: user.syncStatus,
    lastSyncedAt: user.lastSyncedAt,
  });
}
