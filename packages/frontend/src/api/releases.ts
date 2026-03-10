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

export async function fetchReleases(params: {
  year?: string;
  cursor?: string;
  limit?: number;
  sort?: string;
}): Promise<ReleasesPage> {
  const search = new URLSearchParams();
  if (params.year) search.set('year', params.year);
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.sort) search.set('sort', params.sort);

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
