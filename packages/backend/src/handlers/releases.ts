import type { Context } from 'hono';
import { queryUserReleases, getYearsIndex } from '../db/releases.js';
import type { HonoEnv } from '../lib/honoTypes.js';

export async function handleReleases(c: Context<HonoEnv>): Promise<Response> {
  const spotifyId = c.get('spotifyId');
  const year = c.req.query('year');
  const albumType = c.req.query('type');
  const cursor = c.req.query('cursor');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number(limitParam) : undefined;

  const result = await queryUserReleases(spotifyId, {
    year,
    albumType,
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
