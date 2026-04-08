import serverlessExpress from '@codegenie/serverless-express';
import app from './app';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

const serverlessApp = serverlessExpress({ app });

export const handler = async (event: APIGatewayProxyEvent, context: Context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  return serverlessApp(event, context, () => undefined);
};
