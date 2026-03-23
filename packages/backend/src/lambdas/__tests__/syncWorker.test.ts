import type { Context } from 'aws-lambda';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runSyncMock } = vi.hoisted(() => {
  const runSyncMock = vi.fn();
  return { runSyncMock };
});

const { loggerMock, createChildLoggerMock, bindLambdaContextMock, logUnknownErrorMock } =
  vi.hoisted(() => ({
    loggerMock: {
      info: vi.fn(),
      error: vi.fn(),
      appendKeys: vi.fn(),
      addContext: vi.fn(),
    },
    createChildLoggerMock: vi.fn(),
    bindLambdaContextMock: vi.fn(),
    logUnknownErrorMock: vi.fn(),
  }));

const { lambdaSendMock } = vi.hoisted(() => {
  const lambdaSendMock = vi.fn();
  return { lambdaSendMock };
});

vi.mock('../../services/syncService.js', () => ({
  runSync: runSyncMock,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: loggerMock,
  createChildLogger: createChildLoggerMock,
  bindLambdaContext: bindLambdaContextMock,
  logUnknownError: logUnknownErrorMock,
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: lambdaSendMock })),
  InvokeCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { handler } from '../syncWorker.js';
import type { SyncContinuation } from '../../services/syncService.js';

describe('syncWorker', () => {
  const lambdaContext = {
    functionName: 'sync-worker',
    awsRequestId: 'request-1',
    getRemainingTimeInMillis: () => 15 * 60 * 1000, // 15 minutes
  } as Context;

  beforeEach(() => {
    vi.clearAllMocks();
    createChildLoggerMock.mockReturnValue(loggerMock);
    bindLambdaContextMock.mockReturnValue(loggerMock);
    delete process.env['SYNC_WORKER_FUNCTION_NAME'];
  });

  it('calls runSync with deadlineMs calculated from context', async () => {
    runSyncMock.mockResolvedValue(undefined);

    const before = Date.now();
    await handler({ spotifyId: 'user1', syncType: 'quick' }, lambdaContext);
    const after = Date.now();

    expect(runSyncMock).toHaveBeenCalledOnce();
    const [spotifyId, syncType, options] = runSyncMock.mock.calls[0] as [
      string,
      string,
      { deadlineMs: number },
    ];
    expect(spotifyId).toBe('user1');
    expect(syncType).toBe('quick');
    // deadlineMs = Date.now() + 15min - 2min = Date.now() + 13min
    const expectedMin = before + 13 * 60 * 1000;
    const expectedMax = after + 13 * 60 * 1000;
    expect(options.deadlineMs).toBeGreaterThanOrEqual(expectedMin);
    expect(options.deadlineMs).toBeLessThanOrEqual(expectedMax);
  });

  it('passes resumeState to runSync when provided in event', async () => {
    runSyncMock.mockResolvedValue(undefined);

    const resumeState: SyncContinuation = {
      artistIndex: 50,
      skippedCount: 2,
      startedAt: Date.now() - 600_000,
      accumulatedYears: ['2024', '2023'],
      accumulatedGenres: ['rock'],
      currentDelay: 1000,
    };

    await handler({ spotifyId: 'user1', syncType: 'full', resumeState }, lambdaContext);

    expect(runSyncMock).toHaveBeenCalledWith('user1', 'full', {
      resumeState,
      deadlineMs: expect.any(Number),
    });
  });

  it('self-invokes when runSync returns a continuation', async () => {
    process.env['SYNC_WORKER_FUNCTION_NAME'] = 'my-sync-worker';
    const continuation: SyncContinuation = {
      artistIndex: 100,
      skippedCount: 3,
      startedAt: Date.now() - 600_000,
      accumulatedYears: ['2024'],
      accumulatedGenres: ['rock', 'pop'],
      currentDelay: 1000,
    };
    runSyncMock.mockResolvedValue(continuation);
    lambdaSendMock.mockResolvedValue({});

    await handler({ spotifyId: 'user1', syncType: 'full' }, lambdaContext);

    expect(lambdaSendMock).toHaveBeenCalledOnce();
    const { InvokeCommand } = await import('@aws-sdk/client-lambda');
    expect(InvokeCommand).toHaveBeenCalledWith({
      FunctionName: 'my-sync-worker',
      InvocationType: 'Event',
      Payload: expect.any(Buffer),
    });

    // Verify the payload contains the continuation
    const invokeCallArg = (InvokeCommand as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as {
      Payload: Buffer;
    };
    const payload = JSON.parse(invokeCallArg.Payload.toString()) as {
      spotifyId: string;
      syncType: string;
      resumeState: SyncContinuation;
    };
    expect(payload.spotifyId).toBe('user1');
    expect(payload.syncType).toBe('full');
    expect(payload.resumeState).toEqual(continuation);
  });

  it('does not self-invoke when runSync returns undefined (complete)', async () => {
    process.env['SYNC_WORKER_FUNCTION_NAME'] = 'my-sync-worker';
    runSyncMock.mockResolvedValue(undefined);

    await handler({ spotifyId: 'user1', syncType: 'full' }, lambdaContext);

    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('throws when continuation returned but SYNC_WORKER_FUNCTION_NAME not set', async () => {
    const continuation: SyncContinuation = {
      artistIndex: 50,
      skippedCount: 0,
      startedAt: Date.now(),
      accumulatedYears: [],
      accumulatedGenres: [],
      currentDelay: 500,
    };
    runSyncMock.mockResolvedValue(continuation);

    await expect(handler({ spotifyId: 'user1', syncType: 'full' }, lambdaContext)).rejects.toThrow(
      'SYNC_WORKER_FUNCTION_NAME not set',
    );
  });

  it('propagates errors from runSync', async () => {
    runSyncMock.mockRejectedValue(new Error('Sync failed'));

    await expect(handler({ spotifyId: 'user1', syncType: 'quick' }, lambdaContext)).rejects.toThrow(
      'Sync failed',
    );
  });
});
