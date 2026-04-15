import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from './client.js';
import type { SyncContinuation } from '../services/syncService.js';

export interface SyncStatus {
  status: 'running' | 'done' | 'error' | 'paused';
  syncType: 'quick' | 'full';
  totalArtists: number;
  processedArtists: number;
  errorMessage?: string;
  startedAt: number;
  updatedAt: number;
  resumeAfter?: number;
  continuation?: SyncContinuation;
}

export async function putSyncStatus(spotifyId: string, status: SyncStatus): Promise<void> {
  const ttl =
    status.status === 'paused'
      ? Math.floor(Date.now() / 1000) + 90_000 // ~25h for paused
      : Math.floor(Date.now() / 1000) + 3600; // +1h
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
