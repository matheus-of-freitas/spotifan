import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

const { sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  return { sendMock };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual =
    await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({ send: sendMock }),
    },
  };
});

import { handleReleases, handleYears } from '../releases.js';
import type { HonoEnv } from '../../lib/honoTypes.js';

function createApp() {
  const app = new Hono<HonoEnv>();

  app.use('/api/*', async (c, next) => {
    const spotifyId = getCookie(c, '__Host-session');
    if (!spotifyId) return c.json({ error: 'Unauthorized' }, 401);
    c.set('spotifyId', spotifyId);
    return next();
  });

  app.get('/api/releases', handleReleases);
  app.get('/api/releases/years', handleYears);

  return app;
}

describe('releases handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TABLE_NAME'] = 'spotifan-test';
  });

  describe('GET /api/releases', () => {
    it('returns releases with default params', async () => {
      sendMock.mockResolvedValueOnce({
        Items: [
          {
            albumId: 'alb1',
            title: 'Album 1',
            artistId: 'a1',
            artistName: 'Artist 1',
            albumType: 'album',
            imageUrl: 'https://img/1.jpg',
            spotifyUrl: 'https://open.spotify.com/album/alb1',
            releaseDate: '2024-03-15',
            year: '2024',
          },
        ],
        LastEvaluatedKey: undefined,
      });

      const app = createApp();
      const res = await app.request('/api/releases', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { albumId: string }[]; nextCursor?: string };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.albumId).toBe('alb1');
      expect(body.nextCursor).toBeUndefined();
    });

    it('passes year filter to query', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createApp();
      await app.request('/api/releases?year=2024', {
        headers: { cookie: '__Host-session=user1' },
      });

      const queryInput = sendMock.mock.calls[0]![0].input;
      expect(queryInput.ExpressionAttributeValues[':prefix']).toBe('RELEASE#2024');
    });

    it('passes type filter to query', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createApp();
      await app.request('/api/releases?type=album', {
        headers: { cookie: '__Host-session=user1' },
      });

      const queryInput = sendMock.mock.calls[0]![0].input;
      expect(queryInput.FilterExpression).toBe('albumType = :type');
      expect(queryInput.ExpressionAttributeValues[':type']).toBe('album');
    });

    it('passes limit to query', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createApp();
      await app.request('/api/releases?limit=20', {
        headers: { cookie: '__Host-session=user1' },
      });

      const queryInput = sendMock.mock.calls[0]![0].input;
      expect(queryInput.Limit).toBe(20);
    });

    it('returns nextCursor when more results exist', async () => {
      const lastKey = { PK: 'USER#user1', SK: 'RELEASE#2024#2024-01-01#alb1' };
      sendMock.mockResolvedValueOnce({
        Items: [{ albumId: 'alb1' }],
        LastEvaluatedKey: lastKey,
      });

      const app = createApp();
      const res = await app.request('/api/releases', {
        headers: { cookie: '__Host-session=user1' },
      });

      const body = (await res.json()) as { nextCursor: string };
      expect(body.nextCursor).toBeTruthy();
      // Cursor should be base64url-encoded
      const decoded = JSON.parse(
        Buffer.from(body.nextCursor, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      expect(decoded).toEqual(lastKey);
    });

    it('passes cursor to ExclusiveStartKey', async () => {
      const startKey = { PK: 'USER#user1', SK: 'RELEASE#2024#2024-01-01#alb1' };
      const cursor = Buffer.from(JSON.stringify(startKey)).toString('base64url');
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createApp();
      await app.request(`/api/releases?cursor=${cursor}`, {
        headers: { cookie: '__Host-session=user1' },
      });

      const queryInput = sendMock.mock.calls[0]![0].input;
      expect(queryInput.ExclusiveStartKey).toEqual(startKey);
    });
  });

  describe('GET /api/releases/years', () => {
    it('returns years index', async () => {
      sendMock.mockResolvedValueOnce({
        Item: { years: ['2024', '2023', '2022'] },
      });

      const app = createApp();
      const res = await app.request('/api/releases/years', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { years: string[] };
      expect(body.years).toEqual(['2024', '2023', '2022']);
    });

    it('returns empty array when no years index exists', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });

      const app = createApp();
      const res = await app.request('/api/releases/years', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { years: string[] };
      expect(body.years).toEqual([]);
    });
  });
});
