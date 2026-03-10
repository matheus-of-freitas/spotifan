import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export interface Config {
  spotifyClientId: string;
  spotifyClientSecret: string;
  cookieSecret: string;
  tableName: string;
  syncWorkerFunctionName: string;
}

let cached: Config | null = null;

export function clearConfigCache(): void {
  cached = null;
}

export async function getConfig(): Promise<Config> {
  if (cached) return cached;

  const tableName = process.env['TABLE_NAME'] ?? 'spotifan';
  const syncWorkerFunctionName = process.env['SYNC_WORKER_FUNCTION_NAME'] ?? '';

  if (process.env['IS_LOCAL'] === 'true') {
    cached = {
      spotifyClientId: process.env['SPOTIFY_CLIENT_ID'] ?? '',
      spotifyClientSecret: process.env['SPOTIFY_CLIENT_SECRET'] ?? '',
      cookieSecret: process.env['COOKIE_SECRET'] ?? 'local-dev-secret-32-chars-minimum!',
      tableName,
      syncWorkerFunctionName,
    };
    return cached;
  }

  const client = new SecretsManagerClient({});
  const secretName = process.env['SECRET_NAME'] ?? 'spotifan/config';
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  const secret = JSON.parse(response.SecretString ?? '{}') as Record<string, string>;
  cached = {
    spotifyClientId: secret['spotifyClientId'] ?? '',
    spotifyClientSecret: secret['spotifyClientSecret'] ?? '',
    cookieSecret: secret['cookieSecret'] ?? '',
    tableName,
    syncWorkerFunctionName,
  };
  return cached;
}
