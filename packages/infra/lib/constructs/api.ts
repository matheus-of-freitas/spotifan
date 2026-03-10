import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface ApiConstructProps {
  table: dynamodb.Table;
  secret: secretsmanager.ISecret;
}

export class ApiConstruct extends Construct {
  public readonly httpApi: apigw.HttpApi;
  public readonly apiHandler: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const syncWorker = new lambda.Function(this, 'SyncWorker', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'syncWorker.handler',
      code: lambda.Code.fromAsset('../backend/dist'),
      memorySize: 1024,
      timeout: cdk.Duration.minutes(15),
      environment: {
        TABLE_NAME: props.table.tableName,
        SECRET_NAME: props.secret.secretName,
      },
    });

    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'api.handler',
      code: lambda.Code.fromAsset('../backend/dist'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: props.table.tableName,
        SECRET_NAME: props.secret.secretName,
        SYNC_WORKER_FUNCTION_NAME: syncWorker.functionName,
      },
    });

    this.apiHandler = apiHandler;

    props.table.grantReadWriteData(apiHandler);
    props.table.grantReadWriteData(syncWorker);
    props.secret.grantRead(apiHandler);
    props.secret.grantRead(syncWorker);
    syncWorker.grantInvoke(apiHandler);

    this.httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'spotifan-api',
    });

    this.httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigw.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration('ApiIntegration', apiHandler),
    });
  }
}
