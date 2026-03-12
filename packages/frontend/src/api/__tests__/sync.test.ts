import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerSync, fetchSyncStatus } from '../sync';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('triggerSync', () => {
  it('fires POST with sync type', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    await triggerSync('full');
    expect(fetch).toHaveBeenCalledWith('/api/sync?type=full', { method: 'POST' });
  });

  it('defaults to quick sync type', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    await triggerSync();
    expect(fetch).toHaveBeenCalledWith('/api/sync?type=quick', { method: 'POST' });
  });

  it('throws error message from response body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Cooldown active' }),
    } as Response);

    await expect(triggerSync('full')).rejects.toThrow('Cooldown active');
  });

  it('throws default message when response has no error field', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);

    await expect(triggerSync('full')).rejects.toThrow('Failed to start sync');
  });
});

describe('fetchSyncStatus', () => {
  it('returns JSON on ok response', async () => {
    const status = { status: 'idle', totalArtists: 0, processedArtists: 0, lastFullSyncAt: null };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(status),
    } as Response);

    const result = await fetchSyncStatus();
    expect(result).toEqual(status);
  });

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await expect(fetchSyncStatus()).rejects.toThrow('Failed to fetch sync status');
  });
});
