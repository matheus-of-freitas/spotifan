import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchReleases, fetchGenres, fetchYears } from '../releases';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchReleases', () => {
  it('builds URL with all params', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [], nextCursor: null }),
    } as Response);

    await fetchReleases({
      year: '2024',
      cursor: 'abc',
      limit: 20,
      sort: 'date',
      genres: ['rock', 'pop'],
      all: true,
    });

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('year')).toBe('2024');
    expect(params.get('cursor')).toBe('abc');
    expect(params.get('limit')).toBe('20');
    expect(params.get('sort')).toBe('date');
    expect(params.get('genres')).toBe('rock,pop');
    expect(params.get('all')).toBe('true');
  });

  it('computes startDate/endDate for known dateRange presets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    } as Response);

    await fetchReleases({ dateRange: '7d' });

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('endDate')).toBe('2024-06-15');
    expect(params.get('startDate')).toBe('2024-06-08');
  });

  it('does not add startDate/endDate for unknown dateRange', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    } as Response);

    await fetchReleases({ dateRange: 'unknown' });

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.has('startDate')).toBe(false);
    expect(params.has('endDate')).toBe(false);
  });

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await expect(fetchReleases({})).rejects.toThrow('Failed to fetch releases');
  });

  it('omits empty params', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    } as Response);

    await fetchReleases({});

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.has('year')).toBe(false);
    expect(params.has('cursor')).toBe(false);
    expect(params.has('limit')).toBe(false);
    expect(params.has('sort')).toBe(false);
    expect(params.has('genres')).toBe(false);
    expect(params.has('all')).toBe(false);
  });
});

describe('fetchGenres', () => {
  it('returns genres array on ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ genres: ['rock', 'pop'] }),
    } as Response);

    const result = await fetchGenres();
    expect(result).toEqual(['rock', 'pop']);
  });

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await expect(fetchGenres()).rejects.toThrow('Failed to fetch genres');
  });
});

describe('fetchYears', () => {
  it('returns years array on ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ years: ['2024', '2023'] }),
    } as Response);

    const result = await fetchYears();
    expect(result).toEqual(['2024', '2023']);
  });

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await expect(fetchYears()).rejects.toThrow('Failed to fetch years');
  });
});
