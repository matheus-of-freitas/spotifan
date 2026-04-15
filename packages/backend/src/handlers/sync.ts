import type { Context } from 'hono';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { getSyncStatus, putSyncStatus } from '../db/sync.js';
import { getUser } from '../db/users.js';
import { updateSyncStatus } from '../db/users.js';
import { AppError } from '../lib/errors.js';
import { runSync } from '../services/syncService.js';
import type { HonoEnv } from '../lib/honoTypes.js';
import { getContextLogger, logUnknownError } from '../lib/logger.js';

const QUICK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const FULL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const STALE_SYNC_MS = 20 * 60 * 1000; // 20 minutes
const STALE_PAUSED_MS = 25 * 60 * 60 * 1000; // 25 hours

export async function handleSync(c: Context<HonoEnv>): Promise<Response> {
  const log = getContextLogger(c);
  const spotifyId = c.get('spotifyId');
  const syncType = c.req.query('type') === 'full' ? 'full' : 'quick';
  const resume = c.req.query('resume') === 'true';
  log.info('Sync request received', { spotifyId, syncType, resume });

  const user = await getUser(spotifyId);
  if (!user) throw new AppError(404, 'User not found');

  // Gate quick sync: requires at least one completed full sync
  if (syncType === 'quick' && !user.lastFullSyncAt) {
    return c.json({ error: 'full_sync_required', message: 'Run a Full Sync first' }, 400);
  }

  // Handle paused sync resume
  if (user.syncStatus === 'paused') {
    const syncStatus = await getSyncStatus(spotifyId);
    const isStale = !syncStatus || Date.now() - syncStatus.updatedAt > STALE_PAUSED_MS;

    if (isStale) {
      log.error('Resetting stale paused sync', { spotifyId });
      await updateSyncStatus(spotifyId, 'error');
      if (syncStatus) {
        await putSyncStatus(spotifyId, {
          ...syncStatus,
          status: 'error',
          errorMessage: 'Paused sync expired',
        });
      }
      // Fall through to start a fresh sync
    } else if (resume && syncStatus?.continuation) {
      if (syncStatus.resumeAfter && Date.now() < syncStatus.resumeAfter) {
        throw new AppError(429, 'Rate limit cooldown has not elapsed yet');
      }

      const workerFunctionName = process.env['SYNC_WORKER_FUNCTION_NAME'];
      if (workerFunctionName) {
        const lambda = new LambdaClient({});
        log.info('Resuming sync via Lambda', { spotifyId, syncType: syncStatus.syncType });
        await lambda.send(
          new InvokeCommand({
            FunctionName: workerFunctionName,
            InvocationType: 'Event',
            Payload: Buffer.from(
              JSON.stringify({
                spotifyId,
                syncType: syncStatus.syncType,
                resumeState: syncStatus.continuation,
              }),
            ),
          }),
        );
      } else {
        log.info('Resuming local in-process sync', { spotifyId, syncType: syncStatus.syncType });
        runSync(spotifyId, syncStatus.syncType, {
          resumeState: syncStatus.continuation,
        }).catch((err) => {
          logUnknownError(log, 'Local sync resume failed', err, { spotifyId, syncType });
        });
      }

      return c.json({ ok: true, resumed: true }, 202);
    }
    // If not resume, fall through to start a fresh sync
  }

  // Check cooldown (skip for paused → fresh sync, since cooldown wasn't set)
  if (user.syncStatus !== 'paused') {
    const lastSyncField = syncType === 'full' ? 'lastFullSyncAt' : 'lastQuickSyncAt';
    const cooldown = syncType === 'full' ? FULL_COOLDOWN_MS : QUICK_COOLDOWN_MS;

    if (user[lastSyncField] && Date.now() - user[lastSyncField] < cooldown) {
      log.info('Sync request rejected due to cooldown', { spotifyId, syncType });
      throw new AppError(
        429,
        `${syncType} sync available once per ${syncType === 'full' ? '7 days' : '24 hours'}`,
      );
    }
  }

  // Check if already running
  if (user.syncStatus === 'running') {
    const syncStatus = await getSyncStatus(spotifyId);
    const isStale = !syncStatus || Date.now() - syncStatus.updatedAt > STALE_SYNC_MS;

    if (isStale) {
      log.error('Resetting stale running sync before starting a new one', { spotifyId, syncType });
      await updateSyncStatus(spotifyId, 'error');
      if (syncStatus) {
        await putSyncStatus(spotifyId, {
          ...syncStatus,
          status: 'error',
          errorMessage: 'Sync timed out',
        });
      }
    } else {
      log.info('Sync request rejected because another sync is already running', {
        spotifyId,
        syncType,
      });
      throw new AppError(409, 'Sync already in progress');
    }
  }

  const workerFunctionName = process.env['SYNC_WORKER_FUNCTION_NAME'];

  if (workerFunctionName) {
    // Production: invoke Lambda async
    const lambda = new LambdaClient({});
    log.info('Invoking async sync worker', { spotifyId, syncType });
    await lambda.send(
      new InvokeCommand({
        FunctionName: workerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ spotifyId, syncType })),
      }),
    );
  } else {
    // Local: run sync in-process (non-blocking)
    log.info('Starting local in-process sync', { spotifyId, syncType });
    runSync(spotifyId, syncType).catch((err) => {
      logUnknownError(log, 'Local sync failed', err, { spotifyId, syncType });
    });
  }

  return c.json({ ok: true }, 202);
}

export async function handleSyncStatus(c: Context<HonoEnv>): Promise<Response> {
  const log = getContextLogger(c);
  const spotifyId = c.get('spotifyId');
  log.info('Sync status requested', { spotifyId });
  const [status, user] = await Promise.all([getSyncStatus(spotifyId), getUser(spotifyId)]);
  const lastFullSyncAt = user?.lastFullSyncAt ?? null;

  if (!status) {
    return c.json({
      status: 'idle',
      totalArtists: 0,
      processedArtists: 0,
      lastFullSyncAt,
    });
  }

  if (status.status === 'running' && Date.now() - status.updatedAt > STALE_SYNC_MS) {
    log.error('Converting stale running sync status to error', {
      spotifyId,
      syncType: status.syncType,
    });
    const errorStatus = { ...status, status: 'error' as const, errorMessage: 'Sync timed out' };
    await putSyncStatus(spotifyId, errorStatus);
    await updateSyncStatus(spotifyId, 'error');
    return c.json({ ...errorStatus, lastFullSyncAt });
  }

  return c.json({ ...status, lastFullSyncAt });
}
