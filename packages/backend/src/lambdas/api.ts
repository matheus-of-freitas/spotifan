import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { AppError } from '../lib/errors.js';
import type { HonoEnv } from '../lib/honoTypes.js';
import { handleLogin, handleCallback, handleLogout, handleMe } from '../handlers/auth.js';
import { handleSync, handleSyncStatus } from '../handlers/sync.js';

const app = new Hono<HonoEnv>();

// Auth middleware
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const publicPaths = ['/api/auth/login', '/api/auth/callback', '/api/health'];
  if (publicPaths.includes(path)) return next();

  const cookieHeader = c.req.header('cookie') ?? '';
  const sessionMatch = cookieHeader.match(/__Host-session=([^;]+)/);
  const spotifyId = sessionMatch?.[1];

  if (!spotifyId) throw new AppError(401, 'Not authenticated');
  c.set('spotifyId', spotifyId);
  return next();
});

// Health check
app.get('/api/health', (c) => c.json({ ok: true }));

// Auth routes
app.get('/api/auth/login', handleLogin);
app.get('/api/auth/callback', handleCallback);
app.post('/api/auth/logout', handleLogout);
app.get('/api/auth/me', handleMe);

// Sync routes
app.post('/api/sync', handleSync);
app.get('/api/sync/status', handleSyncStatus);

// Error handler
app.onError((err, c) => {
  console.error(err);
  if (err instanceof AppError) {
    return c.json(
      { error: err.message, code: err.code },
      { status: err.statusCode },
    );
  }
  return c.json({ error: 'Internal server error' }, 500);
});

export { app };
export const handler = handle(app);
