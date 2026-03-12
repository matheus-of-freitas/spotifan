import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMe, logout } from '../auth';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('fetchMe', () => {
  it('returns user JSON on ok response', async () => {
    const user = { spotifyId: '123', displayName: 'Test' };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(user),
    } as Response);

    const result = await fetchMe();
    expect(result).toEqual(user);
    expect(fetch).toHaveBeenCalledWith('/api/auth/me');
  });

  it('throws "Not authenticated" on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await expect(fetchMe()).rejects.toThrow('Not authenticated');
  });
});

describe('logout', () => {
  it('fires POST to /api/auth/logout', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    await logout();
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
  });
});
