import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from './client.js';

export interface UserMetadata {
  spotifyId: string;
  displayName: string;
  email?: string;
  imageUrl?: string;
  encryptedRefreshToken: string;
  encryptedAccessToken: string;
  tokenExpiresAt: number;
  syncStatus: 'idle' | 'running' | 'done' | 'error';
  lastQuickSyncAt?: number;
  lastFullSyncAt?: number;
}

export async function getUser(spotifyId: string): Promise<UserMetadata | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: `USER#${spotifyId}`, SK: 'METADATA' },
    }),
  );
  return (result.Item as UserMetadata | undefined) ?? null;
}

export async function putUser(user: UserMetadata): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: `USER#${user.spotifyId}`,
        SK: 'METADATA',
        ...user,
      },
    }),
  );
}

export async function updateSyncStatus(
  spotifyId: string,
  syncStatus: UserMetadata['syncStatus'],
  opts?: { lastQuickSyncAt?: number; lastFullSyncAt?: number },
): Promise<void> {
  const expressionParts = ['syncStatus = :s'];
  const values: Record<string, unknown> = { ':s': syncStatus };

  if (opts?.lastQuickSyncAt !== undefined) {
    expressionParts.push('lastQuickSyncAt = :tq');
    values[':tq'] = opts.lastQuickSyncAt;
  }
  if (opts?.lastFullSyncAt !== undefined) {
    expressionParts.push('lastFullSyncAt = :tf');
    values[':tf'] = opts.lastFullSyncAt;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: `USER#${spotifyId}`, SK: 'METADATA' },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function storePkceState(state: string, verifier: string, ttl: number): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: `PKCE#${state}`,
        SK: 'VERIFIER',
        verifier,
        ttl,
      },
    }),
  );
}

export async function consumePkceState(state: string): Promise<string | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: `PKCE#${state}`, SK: 'VERIFIER' },
    }),
  );
  if (!result.Item) return null;
  const verifier = result.Item['verifier'] as string;
  await docClient.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { PK: `PKCE#${state}`, SK: 'VERIFIER' },
    }),
  );
  return verifier;
}
