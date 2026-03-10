import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from './client.js';

export interface SyncStatus {
  status: 'running' | 'done' | 'error';
  syncType: 'quick' | 'full';
  totalArtists: number;
  processedArtists: number;
  errorMessage?: string;
  startedAt: number;
  updatedAt: number;
}

export async function putSyncStatus(spotifyId: string, status: SyncStatus): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 3600; // +1h
  await docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: `USER#${spotifyId}`,
        SK: 'SYNC#CURRENT',
        ttl,
        ...status,
      },
    }),
  );
}

export async function getSyncStatus(spotifyId: string): Promise<SyncStatus | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: `USER#${spotifyId}`, SK: 'SYNC#CURRENT' },
    }),
  );
  return (result.Item as SyncStatus | undefined) ?? null;
}
