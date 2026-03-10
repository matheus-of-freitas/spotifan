import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation((config) => ({ config })),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation((client, options) => ({
      client,
      options,
    })),
  },
}));

describe('client', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses local endpoint when IS_LOCAL is true', async () => {
    process.env['IS_LOCAL'] = 'true';
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    await import('../client.js');

    expect(DynamoDBClient).toHaveBeenCalledWith({
      region: 'us-east-1',
      endpoint: 'http://localhost:8000',
    });
  });

  it('uses AWS region when not local', async () => {
    delete process.env['IS_LOCAL'];
    process.env['AWS_REGION'] = 'eu-west-1';
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    await import('../client.js');

    expect(DynamoDBClient).toHaveBeenCalledWith({
      region: 'eu-west-1',
    });
  });

  it('defaults to us-east-1 when no AWS_REGION set', async () => {
    delete process.env['IS_LOCAL'];
    delete process.env['AWS_REGION'];
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    await import('../client.js');

    expect(DynamoDBClient).toHaveBeenCalledWith({
      region: 'us-east-1',
    });
  });

  it('getTableName returns TABLE_NAME env var', async () => {
    process.env['TABLE_NAME'] = 'custom-table';
    const { getTableName } = await import('../client.js');
    expect(getTableName()).toBe('custom-table');
  });

  it('getTableName defaults to spotifan', async () => {
    delete process.env['TABLE_NAME'];
    const { getTableName } = await import('../client.js');
    expect(getTableName()).toBe('spotifan');
  });
});
