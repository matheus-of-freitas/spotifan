import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReleaseGrid } from '../ReleaseGrid';
import type { Release } from '../../../api/releases';

const { useInfiniteQueryMock, useSearchReleasesMock, useFilterStoreMock } = vi.hoisted(() => ({
  useInfiniteQueryMock: vi.fn(),
  useSearchReleasesMock: vi.fn(),
  useFilterStoreMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: useInfiniteQueryMock,
}));

vi.mock('../../../hooks/useSearchReleases', () => ({
  useSearchReleases: useSearchReleasesMock,
}));

vi.mock('../../../store/filterStore', () => ({
  useFilterStore: useFilterStoreMock,
}));

const { fetchReleasesMock } = vi.hoisted(() => ({
  fetchReleasesMock: vi.fn(),
}));

vi.mock('../../../api/releases', () => ({
  fetchReleases: fetchReleasesMock,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

let observerCallback: (entries: IntersectionObserverEntry[]) => void;
const observeMock = vi.fn();
const disconnectMock = vi.fn();

class MockIntersectionObserver {
  constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
    observerCallback = callback;
  }
  observe = observeMock;
  disconnect = disconnectMock;
  unobserve = vi.fn();
}

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

const makeRelease = (id: string): Release => ({
  albumId: id,
  title: `Album ${id}`,
  artistId: 'a1',
  artistName: 'Artist',
  albumType: 'album',
  imageUrl: 'http://img.test/cover.jpg',
  spotifyUrl: `https://open.spotify.com/album/${id}`,
  releaseDate: '2024-01-01',
  year: '2024',
  genres: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  useSearchReleasesMock.mockReturnValue({ releases: [], isLoading: false });
});

function setupFilterStore(search = '') {
  useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ year: null, sort: 'date', dateRange: null, genres: [], search }),
  );
}

describe('ReleaseGrid', () => {
  it('renders 12 skeleton cards when loading', () => {
    setupFilterStore();
    useInfiniteQueryMock.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: true,
    });

    render(<ReleaseGrid />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(12);
  });

  it('renders "No releases found" when empty', () => {
    setupFilterStore();
    useInfiniteQueryMock.mockReturnValue({
      data: { pages: [{ items: [] }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    });

    render(<ReleaseGrid />);
    expect(screen.getByText('No releases found')).toBeInTheDocument();
  });

  it('renders release cards when populated', () => {
    setupFilterStore();
    useInfiniteQueryMock.mockReturnValue({
      data: { pages: [{ items: [makeRelease('1'), makeRelease('2')] }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    });

    render(<ReleaseGrid />);
    expect(screen.getByText('Album 1')).toBeInTheDocument();
    expect(screen.getByText('Album 2')).toBeInTheDocument();
  });

  it('renders sentinel div and spinner when fetching next page', () => {
    setupFilterStore();
    useInfiniteQueryMock.mockReturnValue({
      data: { pages: [{ items: [makeRelease('1')] }] },
      fetchNextPage: vi.fn(),
      hasNextPage: true,
      isFetchingNextPage: true,
      isLoading: false,
    });

    render(<ReleaseGrid />);
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('does not render sentinel div when searching', () => {
    setupFilterStore('test');
    useInfiniteQueryMock.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    });
    useSearchReleasesMock.mockReturnValue({
      releases: [makeRelease('1')],
      isLoading: false,
    });

    render(<ReleaseGrid />);
    expect(screen.getByText('Album 1')).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  it('calls fetchNextPage when IntersectionObserver fires', () => {
    setupFilterStore();
    const fetchNextPage = vi.fn();
    useInfiniteQueryMock.mockReturnValue({
      data: { pages: [{ items: [makeRelease('1')] }] },
      fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      isLoading: false,
    });

    render(<ReleaseGrid />);

    observerCallback([{ isIntersecting: true } as IntersectionObserverEntry]);
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('does not call fetchNextPage when not intersecting', () => {
    setupFilterStore();
    const fetchNextPage = vi.fn();
    useInfiniteQueryMock.mockReturnValue({
      data: { pages: [{ items: [makeRelease('1')] }] },
      fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      isLoading: false,
    });

    render(<ReleaseGrid />);
    observerCallback([{ isIntersecting: false } as IntersectionObserverEntry]);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('exercises queryFn with values and getNextPageParam', () => {
    // Set up store with non-null values to hit truthy branches
    useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ year: '2024', sort: 'date', dateRange: '7d', genres: ['rock'], search: '' }),
    );
    fetchReleasesMock.mockResolvedValue({ items: [], nextCursor: 'next' });

    useInfiniteQueryMock.mockImplementation(
      (opts: {
        queryFn: (ctx: { pageParam: string | undefined }) => Promise<unknown>;
        getNextPageParam: (lastPage: { nextCursor?: string }) => string | undefined;
      }) => {
        void opts.queryFn({ pageParam: 'cursor-abc' });
        const next = opts.getNextPageParam({ nextCursor: 'cursor123' });
        expect(next).toBe('cursor123');
        const noNext = opts.getNextPageParam({});
        expect(noNext).toBeUndefined();

        return {
          data: { pages: [{ items: [makeRelease('1')] }] },
          fetchNextPage: vi.fn(),
          hasNextPage: false,
          isFetchingNextPage: false,
          isLoading: false,
        };
      },
    );

    render(<ReleaseGrid />);
    expect(fetchReleasesMock).toHaveBeenCalled();
  });

  it('exercises queryFn with null/empty values for falsy branches', () => {
    // Set up store with null/empty values to hit ?? undefined and ternary falsy branches
    useFilterStoreMock.mockImplementation((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ year: null, sort: 'date', dateRange: null, genres: [], search: '' }),
    );
    fetchReleasesMock.mockResolvedValue({ items: [] });

    useInfiniteQueryMock.mockImplementation(
      (opts: { queryFn: (ctx: { pageParam: string | undefined }) => Promise<unknown> }) => {
        void opts.queryFn({ pageParam: undefined });

        return {
          data: { pages: [{ items: [makeRelease('1')] }] },
          fetchNextPage: vi.fn(),
          hasNextPage: false,
          isFetchingNextPage: false,
          isLoading: false,
        };
      },
    );

    render(<ReleaseGrid />);
    expect(fetchReleasesMock).toHaveBeenCalled();
  });

  it('shows loading skeleton when search is loading', () => {
    setupFilterStore('test');
    useInfiniteQueryMock.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    });
    useSearchReleasesMock.mockReturnValue({ releases: [], isLoading: true });

    render(<ReleaseGrid />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(12);
  });
});
