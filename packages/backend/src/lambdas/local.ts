import { serve } from '@hono/node-server';
import { app } from './api.js';
import { logger } from '../lib/logger.js';

process.env['IS_LOCAL'] = 'true';

serve({ fetch: app.fetch, port: 3000 }, () => {
  logger.info('Local dev server running', { url: 'http://localhost:3000' });
});
