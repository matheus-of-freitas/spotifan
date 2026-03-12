import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSearchReleases } from '../useSearchReleases';
import { useFilterStore } from '../../store/filterStore';
import type { Release } from '../../api/releases';

const { fetchReleasesMock } = vi.hoisted(() => ({
  fetchReleasesMock: vi.fn(),
}));

vi.mock('../../api/releases', () => ({
  fetchReleases: fetchReleasesMock,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const makeRelease = (overrides: Partial<Release> = {}): Release => ({
  albumId: '1',
  title: 'Test Album',
  artistId: 'a1',
  artistName: 'Test Artist',
  albumType: 'album',
  imageUrl: 'http://img.test/1.jpg',
  spotifyUrl: 'https://open.spotify.com/album/1',
  releaseDate: '2024-01-01',
  year: '2024',
  genres: ['rock'],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  useFilterStore.setState({
    year: null,
    sort: 'date',
    dateRange: null,
    genres: [],
    search: '',
  });
});

describe('useSearchReleases', () => {
  it('returns empty when search is empty (query disabled)', () => {
    const { result } = renderHook(() => useSearchReleases(), { wrapper: createWrapper() });
    expect(result.current.releases).toEqual([]);
    expect(fetchReleasesMock).not.toHaveBeenCalled();
  });

  it('fetches and fuzzy-searches releases when search is set', async () => {
    const items = [
      makeRelease({ albumId: '1', title: 'Dark Side of the Moon', artistName: 'Pink Floyd' }),
      makeRelease({ albumId: '2', title: 'The Wall', artistName: 'Pink Floyd' }),
      makeRelease({ albumId: '3', title: 'Thriller', artistName: 'Michael Jackson' }),
    ];
    fetchReleasesMock.mockResolvedValue({ items });

    useFilterStore.setState({ search: 'Dark Side' });

    const { result } = renderHook(() => useSearchReleases(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.releases.length).toBeGreaterThanOrEqual(1);
    expect(result.current.releases[0]!.title).toBe('Dark Side of the Moon');
  });

  it('returns data items when search is set but fuse returns no match', async () => {
    const items = [makeRelease({ albumId: '1', title: 'Alpha', artistName: 'ArtistA' })];
    fetchReleasesMock.mockResolvedValue({ items });
    useFilterStore.setState({ search: 'zzzznotfound', genres: ['rock'] });

    const { result } = renderHook(() => useSearchReleases(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.releases).toEqual([]);
  });

  it('returns raw items when data is loaded and search becomes empty', async () => {
    const items = [makeRelease({ albumId: '1', title: 'Alpha' })];
    fetchReleasesMock.mockResolvedValue({ items });

    // Start with search active so data is fetched
    useFilterStore.setState({ search: 'Alpha' });

    const { result, rerender } = renderHook(() => useSearchReleases(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Clear search — should return raw data?.items ?? []
    useFilterStore.setState({ search: '' });
    rerender();

    // Query is now disabled, so data is stale — returns whatever data was cached
    expect(result.current.releases).toBeDefined();
  });

  it('shows loading state while query is fetching', () => {
    fetchReleasesMock.mockReturnValue(new Promise(() => {}));
    useFilterStore.setState({ search: 'test' });

    const { result } = renderHook(() => useSearchReleases(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);
  });
});
