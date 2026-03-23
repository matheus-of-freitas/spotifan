import type { Context } from 'aws-lambda';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { runSync } from '../services/syncService.js';
import type { SyncContinuation } from '../services/syncService.js';
import { bindLambdaContext, createChildLogger, logUnknownError } from '../lib/logger.js';

interface SyncEvent {
  spotifyId: string;
  syncType: 'quick' | 'full';
  resumeState?: SyncContinuation;
}

const SAFETY_MARGIN_MS = 2 * 60 * 1000;

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
    const deadlineMs = Date.now() + context.getRemainingTimeInMillis() - SAFETY_MARGIN_MS;

    const continuation = await runSync(event.spotifyId, event.syncType, {
      resumeState: event.resumeState,
      deadlineMs,
    });

    if (continuation) {
      const functionName = process.env['SYNC_WORKER_FUNCTION_NAME'];
      if (!functionName) {
        throw new Error('SYNC_WORKER_FUNCTION_NAME not set — cannot self-invoke for continuation');
      }

      syncLogger.info('Self-invoking for continuation', {
        artistIndex: continuation.artistIndex,
      });

      const lambda = new LambdaClient({});
      const payload: SyncEvent = {
        spotifyId: event.spotifyId,
        syncType: event.syncType,
        resumeState: continuation,
      };
      await lambda.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify(payload)),
        }),
      );
    } else {
      syncLogger.info('Sync worker completed');
    }
  } catch (error) {
    logUnknownError(syncLogger, 'Sync worker failed', error);
    throw error;
  }
}
