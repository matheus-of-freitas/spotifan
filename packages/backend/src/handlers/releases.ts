import type { Context } from 'hono';
import { queryUserReleases, queryAllUserReleases, getYearsIndex } from '../db/releases.js';
import type { HonoEnv } from '../lib/honoTypes.js';

type SortField = 'date' | 'artist' | 'title';

const VALID_SORTS = new Set<SortField>(['date', 'artist', 'title']);

function parseSort(value: string | undefined): SortField {
  if (value && VALID_SORTS.has(value as SortField)) return value as SortField;
  return 'date';
}

export async function handleReleases(c: Context<HonoEnv>): Promise<Response> {
  const spotifyId = c.get('spotifyId');
  const year = c.req.query('year');
  const albumType = c.req.query('type');
  const cursor = c.req.query('cursor');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  const sort = parseSort(c.req.query('sort'));

  if (sort === 'date') {
    const result = await queryUserReleases(spotifyId, {
      year,
      albumType,
      cursor,
      limit,
    });
    return c.json(result);
  }

  // For artist/title sort: fetch all, sort in-memory, paginate with offset cursor
  const all = await queryAllUserReleases(spotifyId, { year, albumType });

  const sortKey = sort === 'artist' ? 'artistName' : 'title';
  all.sort((a, b) => a[sortKey].localeCompare(b[sortKey]));

  const pageLimit = Math.min(limit ?? 50, 100);
  let offset = 0;
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        offset?: number;
      };
      offset = decoded.offset ?? 0;
    } catch {
      offset = 0;
    }
  }

  const items = all.slice(offset, offset + pageLimit);
  const nextOffset = offset + pageLimit;
  const nextCursor =
    nextOffset < all.length
      ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64url')
      : undefined;

  return c.json({ items, nextCursor });
}

export async function handleYears(c: Context<HonoEnv>): Promise<Response> {
  const spotifyId = c.get('spotifyId');
  const years = await getYearsIndex(spotifyId);
  return c.json({ years });
}
