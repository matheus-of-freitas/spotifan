import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  return { sendMock };
});

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  GetSecretValueCommand: vi.fn().mockImplementation((input) => input),
}));

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns local config when IS_LOCAL=true', async () => {
    process.env['IS_LOCAL'] = 'true';
    process.env['SPOTIFY_CLIENT_ID'] = 'test-id';
    process.env['SPOTIFY_CLIENT_SECRET'] = 'test-secret';
    process.env['COOKIE_SECRET'] = 'test-cookie-secret';
    process.env['TABLE_NAME'] = 'test-table';
    process.env['SYNC_WORKER_FUNCTION_NAME'] = 'sync-fn';

    const { getConfig } = await import('../config.js');
    const config = await getConfig();

    expect(config).toEqual({
      spotifyClientId: 'test-id',
      spotifyClientSecret: 'test-secret',
      cookieSecret: 'test-cookie-secret',
      tableName: 'test-table',
      syncWorkerFunctionName: 'sync-fn',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns cached config on second call', async () => {
    process.env['IS_LOCAL'] = 'true';
    process.env['SPOTIFY_CLIENT_ID'] = 'test-id';
    process.env['SPOTIFY_CLIENT_SECRET'] = 'test-secret';

    const { getConfig } = await import('../config.js');
    const config1 = await getConfig();
    const config2 = await getConfig();

    expect(config1).toBe(config2); // Same reference
  });

  it('fetches from Secrets Manager when not local', async () => {
    delete process.env['IS_LOCAL'];
    process.env['SECRET_NAME'] = 'my-secret';
    process.env['TABLE_NAME'] = 'prod-table';

    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        spotifyClientId: 'prod-id',
        spotifyClientSecret: 'prod-secret',
        cookieSecret: 'prod-cookie',
      }),
    });

    const { getConfig } = await import('../config.js');
    const config = await getConfig();

    expect(config.spotifyClientId).toBe('prod-id');
    expect(config.spotifyClientSecret).toBe('prod-secret');
    expect(config.cookieSecret).toBe('prod-cookie');
    expect(config.tableName).toBe('prod-table');
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it('clearConfigCache forces re-fetch', async () => {
    process.env['IS_LOCAL'] = 'true';
    process.env['SPOTIFY_CLIENT_ID'] = 'first';

    const { getConfig, clearConfigCache } = await import('../config.js');
    const config1 = await getConfig();
    expect(config1.spotifyClientId).toBe('first');

    process.env['SPOTIFY_CLIENT_ID'] = 'second';
    clearConfigCache();
    const config2 = await getConfig();
    expect(config2.spotifyClientId).toBe('second');
  });

  it('uses defaults when env vars missing in local mode', async () => {
    process.env['IS_LOCAL'] = 'true';
    delete process.env['SPOTIFY_CLIENT_ID'];
    delete process.env['SPOTIFY_CLIENT_SECRET'];
    delete process.env['COOKIE_SECRET'];
    delete process.env['TABLE_NAME'];
    delete process.env['SYNC_WORKER_FUNCTION_NAME'];

    const { getConfig } = await import('../config.js');
    const config = await getConfig();

    expect(config.spotifyClientId).toBe('');
    expect(config.tableName).toBe('spotifan');
    expect(config.syncWorkerFunctionName).toBe('');
    expect(config.cookieSecret).toBeTruthy(); // Has a default
  });

  it('handles missing keys in Secrets Manager response', async () => {
    delete process.env['IS_LOCAL'];
    sendMock.mockResolvedValueOnce({
      SecretString: JSON.stringify({}),
    });

    const { getConfig } = await import('../config.js');
    const config = await getConfig();

    expect(config.spotifyClientId).toBe('');
    expect(config.spotifyClientSecret).toBe('');
    expect(config.cookieSecret).toBe('');
  });

  it('handles null SecretString', async () => {
    delete process.env['IS_LOCAL'];
    sendMock.mockResolvedValueOnce({ SecretString: null });

    const { getConfig } = await import('../config.js');
    const config = await getConfig();

    expect(config.spotifyClientId).toBe('');
  });
});
