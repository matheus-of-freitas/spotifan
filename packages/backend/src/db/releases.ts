import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from './client.js';

export interface Release {
  albumId: string;
  title: string;
  artistId: string;
  artistName: string;
  albumType: 'album' | 'single' | 'compilation';
  imageUrl: string;
  spotifyUrl: string;
  releaseDate: string;
  year: string;
}

export interface ReleasesPage {
  items: Release[];
  nextCursor?: string;
}

export async function batchWriteUserReleases(
  spotifyId: string,
  releases: Release[],
): Promise<void> {
  const tableName = getTableName();

  const chunks = chunk(releases, 25);
  for (const batch of chunks) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((r) => ({
            PutRequest: {
              Item: {
                PK: `USER#${spotifyId}`,
                SK: `RELEASE#${r.year}#${r.releaseDate}#${r.albumId}`,
                ...r,
              },
            },
          })),
        },
      }),
    );
  }
}

export async function getUserExistingAlbumIds(spotifyId: string): Promise<Set<string>> {
  const albumIds = new Set<string>();
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${spotifyId}`, ':prefix': 'RELEASE#' },
        ProjectionExpression: 'albumId',
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of result.Items ?? []) {
      albumIds.add(item['albumId'] as string);
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return albumIds;
}

export async function batchWriteArtistReleases(releases: Release[]): Promise<void> {
  const tableName = getTableName();
  const ttl = Math.floor(Date.now() / 1000) + 86400; // +24h

  const chunks = chunk(releases, 25);
  for (const batch of chunks) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((r) => ({
            PutRequest: {
              Item: {
                PK: `ARTIST#${r.artistId}`,
                SK: `RELEASE#${r.albumId}`,
                ttl,
                ...r,
              },
            },
          })),
        },
      }),
    );
  }
}

export async function getArtistReleasesCached(artistId: string): Promise<Release[] | null> {
  const now = Math.floor(Date.now() / 1000);
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `ARTIST#${artistId}`,
        ':prefix': 'RELEASE#',
        ':now': now,
      },
      FilterExpression: '#ttl > :now',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
    }),
  );
  if (!result.Items || result.Items.length === 0) return null;
  return result.Items as Release[];
}

export async function queryUserReleases(
  spotifyId: string,
  opts: {
    year?: string;
    albumType?: string;
    startDate?: string;
    endDate?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<ReleasesPage> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const prefix = opts.year ? `RELEASE#${opts.year}` : 'RELEASE#';

  const filterParts: string[] = [];
  const exprValues: Record<string, unknown> = {
    ':pk': `USER#${spotifyId}`,
    ':prefix': prefix,
  };

  if (opts.albumType) {
    filterParts.push('albumType = :type');
    exprValues[':type'] = opts.albumType;
  }

  if (opts.startDate && opts.endDate) {
    filterParts.push('releaseDate BETWEEN :startDate AND :endDate');
    exprValues[':startDate'] = opts.startDate;
    exprValues[':endDate'] = opts.endDate;
  }

  const filterExpression = filterParts.length > 0 ? filterParts.join(' AND ') : undefined;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: exprValues,
      ...(filterExpression ? { FilterExpression: filterExpression } : {}),
      ScanIndexForward: false,
      Limit: limit,
      ...(opts.cursor
        ? {
            ExclusiveStartKey: JSON.parse(Buffer.from(opts.cursor, 'base64url').toString('utf8')),
          }
        : {}),
    }),
  );

  const items = (result.Items ?? []) as Release[];
  let nextCursor: string | undefined;
  if (result.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url');
  }

  return { items, nextCursor };
}

export async function getYearsIndex(spotifyId: string): Promise<string[]> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: `USER#${spotifyId}`, SK: 'YEARS#INDEX' },
    }),
  );
  return (result.Item?.['years'] as string[] | undefined) ?? [];
}

export async function putYearsIndex(spotifyId: string, years: string[]): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: `USER#${spotifyId}`,
        SK: 'YEARS#INDEX',
        years,
      },
    }),
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
