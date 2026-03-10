import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const isLocal = process.env['IS_LOCAL'] === 'true';

const ddbClient = new DynamoDBClient(
  isLocal
    ? { region: 'us-east-1', endpoint: 'http://localhost:8000' }
    : { region: process.env['AWS_REGION'] ?? 'us-east-1' },
);

export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export function getTableName(): string {
  return process.env['TABLE_NAME'] ?? 'spotifan';
}
