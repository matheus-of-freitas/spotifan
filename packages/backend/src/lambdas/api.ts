import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { handle } from 'hono/aws-lambda';
import { AppError } from '../lib/errors.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { HonoEnv } from '../lib/honoTypes.js';
import { handleLogin, handleCallback, handleLogout, handleMe } from '../handlers/auth.js';
import { handleSync, handleSyncStatus } from '../handlers/sync.js';
import { handleReleases, handleYears, handleGenres } from '../handlers/releases.js';
import { createChildLogger, getContextLogger, logUnknownError } from '../lib/logger.js';

const app = new Hono<HonoEnv>();
const honoHandler = handle(app);

// Auth middleware
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const requestLogger = createChildLogger({
    route: path,
    method: c.req.method,
  });
  c.set('logger', requestLogger);

  const publicPaths = ['/api/auth/login', '/api/auth/callback', '/api/health'];
  if (publicPaths.includes(path)) return next();

  const isLocal = process.env['IS_LOCAL'] === 'true';
  const cookieName = isLocal ? 'session' : '__Host-session';
  const spotifyId = getCookie(c, cookieName);

  if (!spotifyId) throw new AppError(401, 'Not authenticated');
  c.set('spotifyId', spotifyId);
  requestLogger.appendKeys({ spotifyId });
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

// Release routes
app.get('/api/releases', handleReleases);
app.get('/api/releases/years', handleYears);
app.get('/api/releases/genres', handleGenres);

// Error handler
app.onError((err, c) => {
  const requestLogger = getContextLogger(c);
  if (err instanceof AppError) {
    requestLogger.error('API request failed', {
      route: new URL(c.req.url).pathname,
      statusCode: err.statusCode,
      code: err.code ?? null,
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack ?? null,
    });
    return c.json(
      { error: err.message, code: err.code },
      { status: err.statusCode as ContentfulStatusCode },
    );
  }

  logUnknownError(requestLogger, 'Unhandled API error', err, {
    route: new URL(c.req.url).pathname,
  });
  return c.json({ error: 'Internal server error' }, 500);
});

export { app };
export const handler = async (event: Parameters<typeof honoHandler>[0], context: Parameters<typeof honoHandler>[1]) => {
  const requestContext = 'requestContext' in event ? event.requestContext : undefined;
  const route =
    'rawPath' in event ? event.rawPath : 'path' in event ? event.path : undefined;
  const method =
    requestContext && 'http' in requestContext
      ? requestContext.http.method
      : 'requestContext' in event && 'httpMethod' in event
        ? event.httpMethod
        : undefined;

  const childLogger = createChildLogger({
    handler: 'api',
    route,
    method,
    requestId: context?.awsRequestId,
  });
  const requestLogger = childLogger;

  requestLogger.info('API Lambda invocation started');
  try {
    const response = await honoHandler(event, context);
    requestLogger.info('API Lambda invocation completed', {
      statusCode: response.statusCode,
    });
    return response;
  } catch (error) {
    logUnknownError(requestLogger, 'API Lambda invocation failed', error);
    throw error;
  }
};
