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

vi.mock('../../services/syncService.js', () => ({
  runSync: runSyncMock,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: loggerMock,
  createChildLogger: createChildLoggerMock,
  bindLambdaContext: bindLambdaContextMock,
  logUnknownError: logUnknownErrorMock,
}));

import { handler } from '../syncWorker.js';

describe('syncWorker', () => {
  const lambdaContext = { functionName: 'sync-worker', awsRequestId: 'request-1' } as Context;

  beforeEach(() => {
    vi.clearAllMocks();
    createChildLoggerMock.mockReturnValue(loggerMock);
    bindLambdaContextMock.mockReturnValue(loggerMock);
  });

  it('calls runSync with the spotifyId and syncType from the event', async () => {
    runSyncMock.mockResolvedValue(undefined);

    await handler({ spotifyId: 'user1', syncType: 'quick' }, lambdaContext);

    expect(runSyncMock).toHaveBeenCalledWith('user1', 'quick');
  });

  it('passes full syncType to runSync', async () => {
    runSyncMock.mockResolvedValue(undefined);

    await handler({ spotifyId: 'user1', syncType: 'full' }, lambdaContext);

    expect(runSyncMock).toHaveBeenCalledWith('user1', 'full');
  });

  it('propagates errors from runSync', async () => {
    runSyncMock.mockRejectedValue(new Error('Sync failed'));

    await expect(handler({ spotifyId: 'user1', syncType: 'quick' }, lambdaContext)).rejects.toThrow(
      'Sync failed',
    );
  });
});
