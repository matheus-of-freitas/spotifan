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
  it('calls runSync with the spotifyId from the event', async () => {
    runSyncMock.mockResolvedValue(undefined);

    await handler({ spotifyId: 'user1' });

    expect(runSyncMock).toHaveBeenCalledWith('user1');
  });

  it('propagates errors from runSync', async () => {
    runSyncMock.mockRejectedValue(new Error('Sync failed'));

    await expect(handler({ spotifyId: 'user1' })).rejects.toThrow('Sync failed');
  });
});
