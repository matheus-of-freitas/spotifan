import type { Context } from 'hono';
import {
  queryUserReleases,
  queryAllUserReleases,
  getYearsIndex,
  getGenresIndex,
} from '../db/releases.js';
import type { HonoEnv } from '../lib/honoTypes.js';
import { getContextLogger } from '../lib/logger.js';

type SortField = 'date' | 'artist' | 'title';

const VALID_SORTS = new Set<SortField>(['date', 'artist', 'title']);

function parseSort(value: string | undefined): SortField {
  if (value && VALID_SORTS.has(value as SortField)) return value as SortField;
  return 'date';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleReleases(c: Context<HonoEnv>): Promise<Response> {
  const log = getContextLogger(c);
  const spotifyId = c.get('spotifyId');
  const year = c.req.query('year');
  const albumType = c.req.query('type');
  const cursor = c.req.query('cursor');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  const sort = parseSort(c.req.query('sort'));

  const startDateParam = c.req.query('startDate');
  const endDateParam = c.req.query('endDate');
  const startDate = startDateParam && DATE_RE.test(startDateParam) ? startDateParam : undefined;
  const endDate = endDateParam && DATE_RE.test(endDateParam) ? endDateParam : undefined;

  const genresParam = c.req.query('genres');
  const genres = genresParam ? genresParam.split(',').filter(Boolean) : undefined;

  const fetchAll = c.req.query('all') === 'true';

  log.info('Fetching releases', {
    spotifyId,
    sort,
    year,
    albumType,
    limit: limit ?? null,
    hasCursor: Boolean(cursor),
    genreCount: genres?.length ?? 0,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    fetchAll,
  });

  if (fetchAll) {
    const all = await queryAllUserReleases(spotifyId, { year, albumType });
    return c.json({ items: all });
  }

  if (sort === 'date') {
    const result = await queryUserReleases(spotifyId, {
      year,
      albumType,
      genres,
      startDate,
      endDate,
      cursor,
      limit,
    });
    return c.json(result);
  }

  // For artist/title sort: fetch all, sort in-memory, paginate with offset cursor
  log.info('Using in-memory release sort', { spotifyId, sort });
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
      log.error('Failed to decode releases cursor, defaulting to first page', {
        spotifyId,
        sort,
      });
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
  const log = getContextLogger(c);
  const spotifyId = c.get('spotifyId');
  log.info('Fetching years index', { spotifyId });
  const years = await getYearsIndex(spotifyId);
  return c.json({ years });
}

export async function handleGenres(c: Context<HonoEnv>): Promise<Response> {
  const log = getContextLogger(c);
  const spotifyId = c.get('spotifyId');
  log.info('Fetching genres index', { spotifyId });
  const genres = await getGenresIndex(spotifyId);
  return c.json({ genres });
}
