import type { Context } from 'hono';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { getSyncStatus } from '../db/sync.js';
import { getUser } from '../db/users.js';
import { AppError } from '../lib/errors.js';
import { runSync } from '../services/syncService.js';
import type { HonoEnv } from '../lib/honoTypes.js';

const QUICK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const FULL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function handleSync(c: Context<HonoEnv>): Promise<Response> {
  const spotifyId = c.get('spotifyId');
  const syncType = c.req.query('type') === 'full' ? 'full' : 'quick';

  const user = await getUser(spotifyId);
  if (!user) throw new AppError(404, 'User not found');

  // Check cooldown
  const lastSyncField = syncType === 'full' ? 'lastFullSyncAt' : 'lastQuickSyncAt';
  const cooldown = syncType === 'full' ? FULL_COOLDOWN_MS : QUICK_COOLDOWN_MS;

  if (user[lastSyncField] && Date.now() - user[lastSyncField] < cooldown) {
    throw new AppError(
      429,
      `${syncType} sync available once per ${syncType === 'full' ? '7 days' : '24 hours'}`,
    );
  }

  // Check if already running
  if (user.syncStatus === 'running') {
    throw new AppError(409, 'Sync already in progress');
  }

  const workerFunctionName = process.env['SYNC_WORKER_FUNCTION_NAME'];

  if (workerFunctionName) {
    // Production: invoke Lambda async
    const lambda = new LambdaClient({});
    await lambda.send(
      new InvokeCommand({
        FunctionName: workerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ spotifyId, syncType })),
      }),
    );
  } else {
    // Local: run sync in-process (non-blocking)
    runSync(spotifyId, syncType).catch((err) => {
      console.error('Sync failed:', err);
    });
  }

  return c.json({ ok: true }, 202);
}

export async function handleSyncStatus(c: Context<HonoEnv>): Promise<Response> {
  const spotifyId = c.get('spotifyId');
  const status = await getSyncStatus(spotifyId);

  if (!status) {
    return c.json({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
    });
  }

  return c.json(status);
}
