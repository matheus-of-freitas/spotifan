import type { Context } from 'aws-lambda';
import { runSync } from '../services/syncService.js';
import { bindLambdaContext, createChildLogger, logUnknownError } from '../lib/logger.js';

interface SyncEvent {
  spotifyId: string;
  syncType: 'quick' | 'full';
}

export async function handler(event: SyncEvent, context: Context): Promise<void> {
  const syncLogger = bindLambdaContext(
    createChildLogger({
      handler: 'syncWorker',
      spotifyId: event.spotifyId,
      syncType: event.syncType,
    }),
    context,
  );

  syncLogger.info('Sync worker invoked');
  try {
    await runSync(event.spotifyId, event.syncType);
    syncLogger.info('Sync worker completed');
  } catch (error) {
    logUnknownError(syncLogger, 'Sync worker failed', error);
    throw error;
  }
}
