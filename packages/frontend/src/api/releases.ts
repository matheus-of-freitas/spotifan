export interface Release {
  albumId: string;
  title: string;
  artistId: string;
  artistName: string;
  albumType: string;
  imageUrl: string;
  spotifyUrl: string;
  releaseDate: string;
  year: string;
}

interface ReleasesPage {
  items: Release[];
  nextCursor?: string;
}

const DATE_RANGE_DAYS: Record<string, number> = {
  '7d': 7,
  '15d': 15,
  '1m': 30,
  '3m': 90,
  '6m': 180,
};

function computeDateRange(preset: string): { startDate: string; endDate: string } | null {
  const days = DATE_RANGE_DAYS[preset];
  if (!days) return null;
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return { startDate, endDate };
}

export async function fetchReleases(params: {
  year?: string;
  cursor?: string;
  limit?: number;
  sort?: string;
  dateRange?: string;
}): Promise<ReleasesPage> {
  const search = new URLSearchParams();
  if (params.year) search.set('year', params.year);
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.sort) search.set('sort', params.sort);

  if (params.dateRange) {
    const range = computeDateRange(params.dateRange);
    if (range) {
      search.set('startDate', range.startDate);
      search.set('endDate', range.endDate);
    }
  }

  const res = await fetch(`/api/releases?${search}`);
  if (!res.ok) throw new Error('Failed to fetch releases');
  return res.json();
}

export async function fetchYears(): Promise<string[]> {
  const res = await fetch('/api/releases/years');
  if (!res.ok) throw new Error('Failed to fetch years');
  const data: { years: string[] } = await res.json();
  return data.years;
}
