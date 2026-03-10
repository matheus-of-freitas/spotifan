import { describe, it, expect, vi } from 'vitest';

const { runSyncMock } = vi.hoisted(() => {
  const runSyncMock = vi.fn();
  return { runSyncMock };
});

vi.mock('../../services/syncService.js', () => ({
  runSync: runSyncMock,
}));

import { handler } from '../syncWorker.js';

describe('syncWorker', () => {
  it('calls runSync with the spotifyId and syncType from the event', async () => {
    runSyncMock.mockResolvedValue(undefined);

    await handler({ spotifyId: 'user1', syncType: 'quick' });

    expect(runSyncMock).toHaveBeenCalledWith('user1', 'quick');
  });

  it('passes full syncType to runSync', async () => {
    runSyncMock.mockResolvedValue(undefined);

    await handler({ spotifyId: 'user1', syncType: 'full' });

    expect(runSyncMock).toHaveBeenCalledWith('user1', 'full');
  });

  it('propagates errors from runSync', async () => {
    runSyncMock.mockRejectedValue(new Error('Sync failed'));

    await expect(handler({ spotifyId: 'user1', syncType: 'quick' })).rejects.toThrow(
      'Sync failed',
    );
  });
});
