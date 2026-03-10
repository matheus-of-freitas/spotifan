import type { Context } from 'hono';
import { queryUserReleases, getYearsIndex } from '../db/releases.js';
import type { HonoEnv } from '../lib/honoTypes.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleReleases(c: Context<HonoEnv>): Promise<Response> {
  const spotifyId = c.get('spotifyId');
  const year = c.req.query('year');
  const albumType = c.req.query('type');
  const cursor = c.req.query('cursor');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number(limitParam) : undefined;

  const startDateParam = c.req.query('startDate');
  const endDateParam = c.req.query('endDate');
  const startDate = startDateParam && DATE_RE.test(startDateParam) ? startDateParam : undefined;
  const endDate = endDateParam && DATE_RE.test(endDateParam) ? endDateParam : undefined;

  const result = await queryUserReleases(spotifyId, {
    year,
    albumType,
    startDate,
    endDate,
    cursor,
    limit,
  });

  return c.json(result);
}

export async function handleYears(c: Context<HonoEnv>): Promise<Response> {
  const spotifyId = c.get('spotifyId');
  const years = await getYearsIndex(spotifyId);
  return c.json({ years });
}
