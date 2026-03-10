import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';
import { fetchReleases } from '../../api/releases';
import { useFilterStore } from '../../store/filterStore';
import { ReleaseCard } from './ReleaseCard';

export function ReleaseGrid() {
  const year = useFilterStore((s) => s.year);
  const dateRange = useFilterStore((s) => s.dateRange);
  const observerRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['releases', { year, dateRange }],
    queryFn: ({ pageParam }) =>
      fetchReleases({
        year: year ?? undefined,
        cursor: pageParam as string | undefined,
        dateRange: dateRange ?? undefined,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
  });

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const entry = entries[0];
      if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  const releases = data?.pages.flatMap((p) => p.items) ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-md bg-spotify-card-bg p-4">
            <div className="mb-4 aspect-square rounded-md bg-spotify-gray-dark" />
            <div className="mb-2 h-4 rounded bg-spotify-gray-dark" />
            <div className="h-3 w-2/3 rounded bg-spotify-gray-dark" />
          </div>
        ))}
      </div>
    );
  }

  if (releases.length === 0) {
    return (
      <div className="py-12 text-center text-spotify-gray-light">
        <p className="text-lg">No releases found</p>
        <p className="mt-2 text-sm">Try syncing your library first</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {releases.map((release, i) => (
          <ReleaseCard key={release.albumId} release={release} index={i} />
        ))}
      </div>
      <div ref={observerRef} className="h-10" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-spotify-green border-t-transparent" />
        </div>
      )}
    </>
  );
}
