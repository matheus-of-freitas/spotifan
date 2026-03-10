import { serve } from '@hono/node-server';
import { app } from './api.js';

process.env['IS_LOCAL'] = 'true';

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('Local dev server running on http://localhost:3000');
});
