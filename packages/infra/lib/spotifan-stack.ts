import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { DatabaseConstruct } from './constructs/database';
import { ApiConstruct } from './constructs/api';
import { FrontendConstruct } from './constructs/frontend';

export class SpotifanStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const secret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'SpotifanSecret',
      'spotifan/config',
    );

    const database = new DatabaseConstruct(this, 'Database');

    const api = new ApiConstruct(this, 'Api', {
      table: database.table,
      secret,
    });

    const frontend = new FrontendConstruct(this, 'Frontend', {
      httpApi: api.httpApi,
    });

    api.apiHandler.addEnvironment(
      'BASE_URL',
      `https://${frontend.distribution.distributionDomainName}`,
    );
  }
}
