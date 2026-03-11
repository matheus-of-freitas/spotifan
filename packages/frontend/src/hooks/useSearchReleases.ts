import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Fuse from 'fuse.js';
import { fetchReleases } from '../api/releases';
import type { Release } from '../api/releases';
import { useFilterStore } from '../store/filterStore';

export function useSearchReleases() {
  const search = useFilterStore((s) => s.search);
  const year = useFilterStore((s) => s.year);
  const sort = useFilterStore((s) => s.sort);
  const dateRange = useFilterStore((s) => s.dateRange);
  const genres = useFilterStore((s) => s.genres);

  const { data, isLoading } = useQuery({
    queryKey: ['releases-all', { year, sort, dateRange, genres }],
    queryFn: () =>
      fetchReleases({
        year: year ?? undefined,
        sort,
        dateRange: dateRange ?? undefined,
        genres: genres.length > 0 ? genres : undefined,
        all: true,
      }),
    enabled: search.length > 0,
  });

  const fuse = useMemo(() => {
    const items = data?.items ?? [];
    return new Fuse(items, {
      keys: ['title', 'artistName'],
      threshold: 0.3,
      ignoreLocation: true,
    });
  }, [data]);

  const results: Release[] = useMemo(() => {
    if (!search) return data?.items ?? [];
    return fuse.search(search).map((r) => r.item);
  }, [fuse, search, data]);

  return { releases: results, isLoading };
}
