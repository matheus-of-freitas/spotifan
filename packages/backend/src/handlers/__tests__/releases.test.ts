import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

const { sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  return { sendMock };
});

const { loggerMock, getContextLoggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    error: vi.fn(),
    appendKeys: vi.fn(),
    addContext: vi.fn(),
  },
  getContextLoggerMock: vi.fn(),
}));

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

vi.mock('../../lib/logger.js', () => ({
  logger: loggerMock,
  getContextLogger: getContextLoggerMock,
}));

import { handleReleases, handleYears, handleGenres } from '../releases.js';
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
  app.get('/api/releases/genres', handleGenres);

  return app;
}

describe('releases handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContextLoggerMock.mockReturnValue(loggerMock);
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

    it('sorts by artist name with in-memory sort', async () => {
      // queryAllUserReleases pages through all results
      sendMock.mockResolvedValueOnce({
        Items: [
          {
            albumId: 'alb2',
            title: 'B Album',
            artistId: 'a2',
            artistName: 'Zed',
            albumType: 'album',
            imageUrl: '',
            spotifyUrl: '',
            releaseDate: '2024-01-01',
            year: '2024',
          },
          {
            albumId: 'alb1',
            title: 'A Album',
            artistId: 'a1',
            artistName: 'Alpha',
            albumType: 'album',
            imageUrl: '',
            spotifyUrl: '',
            releaseDate: '2024-06-01',
            year: '2024',
          },
        ],
        LastEvaluatedKey: undefined,
      });

      const app = createApp();
      const res = await app.request('/api/releases?sort=artist', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { artistName: string }[] };
      expect(body.items[0]!.artistName).toBe('Alpha');
      expect(body.items[1]!.artistName).toBe('Zed');
    });

    it('sorts by title with in-memory sort', async () => {
      sendMock.mockResolvedValueOnce({
        Items: [
          {
            albumId: 'alb2',
            title: 'Zebra',
            artistId: 'a1',
            artistName: 'Artist',
            albumType: 'album',
            imageUrl: '',
            spotifyUrl: '',
            releaseDate: '2024-01-01',
            year: '2024',
          },
          {
            albumId: 'alb1',
            title: 'Alpha',
            artistId: 'a1',
            artistName: 'Artist',
            albumType: 'album',
            imageUrl: '',
            spotifyUrl: '',
            releaseDate: '2024-06-01',
            year: '2024',
          },
        ],
        LastEvaluatedKey: undefined,
      });

      const app = createApp();
      const res = await app.request('/api/releases?sort=title', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { title: string }[] };
      expect(body.items[0]!.title).toBe('Alpha');
      expect(body.items[1]!.title).toBe('Zebra');
    });

    it('defaults invalid sort to date', async () => {
      sendMock.mockResolvedValueOnce({
        Items: [{ albumId: 'alb1' }],
        LastEvaluatedKey: undefined,
      });

      const app = createApp();
      const res = await app.request('/api/releases?sort=invalid', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      // date sort uses queryUserReleases (single DB call with Limit)
      const cmd = sendMock.mock.calls[0]![0].input;
      expect(cmd.Limit).toBe(50); // queryUserReleases sets Limit
    });

    it('handles offset cursor pagination for artist sort', async () => {
      const items = Array.from({ length: 5 }, (_, i) => ({
        albumId: `alb${i}`,
        title: `Album ${i}`,
        artistId: `a${i}`,
        artistName: `Artist ${String.fromCharCode(65 + i)}`,
        albumType: 'album',
        imageUrl: '',
        spotifyUrl: '',
        releaseDate: '2024-01-01',
        year: '2024',
      }));
      sendMock.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: undefined });

      const cursor = Buffer.from(JSON.stringify({ offset: 2 })).toString('base64url');
      const app = createApp();
      const res = await app.request(`/api/releases?sort=artist&cursor=${cursor}&limit=2`, {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { artistName: string }[];
        nextCursor?: string;
      };
      expect(body.items).toHaveLength(2);
      expect(body.items[0]!.artistName).toBe('Artist C');
      expect(body.nextCursor).toBeDefined();
    });

    it('handles invalid cursor gracefully for artist sort', async () => {
      sendMock.mockResolvedValueOnce({
        Items: [
          {
            albumId: 'alb1',
            title: 'Album',
            artistId: 'a1',
            artistName: 'Artist',
            albumType: 'album',
            imageUrl: '',
            spotifyUrl: '',
            releaseDate: '2024-01-01',
            year: '2024',
          },
        ],
        LastEvaluatedKey: undefined,
      });

      const app = createApp();
      const res = await app.request('/api/releases?sort=artist&cursor=not-valid-base64', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { albumId: string }[] };
      expect(body.items).toHaveLength(1);
    });

    it('defaults offset to 0 when cursor has no offset field', async () => {
      sendMock.mockResolvedValueOnce({
        Items: [
          {
            albumId: 'alb1',
            title: 'Album',
            artistId: 'a1',
            artistName: 'Artist',
            albumType: 'album',
            imageUrl: '',
            spotifyUrl: '',
            releaseDate: '2024-01-01',
            year: '2024',
          },
        ],
        LastEvaluatedKey: undefined,
      });

      const cursor = Buffer.from(JSON.stringify({})).toString('base64url');
      const app = createApp();
      const res = await app.request(`/api/releases?sort=artist&cursor=${cursor}`, {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { albumId: string }[] };
      expect(body.items).toHaveLength(1);
    });

    it('combines sort with year filter', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createApp();
      await app.request('/api/releases?sort=artist&year=2024', {
        headers: { cookie: '__Host-session=user1' },
      });

      const cmd = sendMock.mock.calls[0]![0].input;
      expect(cmd.ExpressionAttributeValues[':prefix']).toBe('RELEASE#2024');
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

    it('passes valid startDate and endDate to query', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createApp();
      await app.request('/api/releases?startDate=2024-01-01&endDate=2024-06-30', {
        headers: { cookie: '__Host-session=user1' },
      });

      const queryInput = sendMock.mock.calls[0]![0].input;
      expect(queryInput.FilterExpression).toBe('releaseDate BETWEEN :startDate AND :endDate');
      expect(queryInput.ExpressionAttributeValues[':startDate']).toBe('2024-01-01');
      expect(queryInput.ExpressionAttributeValues[':endDate']).toBe('2024-06-30');
    });

    it('ignores invalid date format', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createApp();
      await app.request('/api/releases?startDate=not-a-date&endDate=2024-06-30', {
        headers: { cookie: '__Host-session=user1' },
      });

      const queryInput = sendMock.mock.calls[0]![0].input;
      expect(queryInput.FilterExpression).toBeUndefined();
    });

    it('passes genres filter to query', async () => {
      sendMock.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createApp();
      await app.request('/api/releases?genres=rock,pop', {
        headers: { cookie: '__Host-session=user1' },
      });

      const queryInput = sendMock.mock.calls[0]![0].input;
      expect(queryInput.FilterExpression).toBe(
        '(contains(genres, :genre0) OR contains(genres, :genre1))',
      );
      expect(queryInput.ExpressionAttributeValues[':genre0']).toBe('rock');
      expect(queryInput.ExpressionAttributeValues[':genre1']).toBe('pop');
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

  describe('GET /api/releases/genres', () => {
    it('returns genres index', async () => {
      sendMock.mockResolvedValueOnce({
        Item: { genres: ['indie', 'pop', 'rock'] },
      });

      const app = createApp();
      const res = await app.request('/api/releases/genres', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { genres: string[] };
      expect(body.genres).toEqual(['indie', 'pop', 'rock']);
    });

    it('returns empty array when no genres index exists', async () => {
      sendMock.mockResolvedValueOnce({ Item: undefined });

      const app = createApp();
      const res = await app.request('/api/releases/genres', {
        headers: { cookie: '__Host-session=user1' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { genres: string[] };
      expect(body.genres).toEqual([]);
    });
  });
});
