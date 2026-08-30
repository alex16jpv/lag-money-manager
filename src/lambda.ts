import serverlessExpress from '@codegenie/serverless-express';
import app from './app';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { pingDatabase } from './config/dbHealth';
import { IS_LAMBDA } from './shared/constants';

const serverlessApp = serverlessExpress({ app });

export const KEEPALIVE_EVENT_SOURCE = 'lag.keepalive';

type KeepaliveEvent = { source?: string };

export const handler = async (
  event: APIGatewayProxyEvent | KeepaliveEvent,
  context: Context,
) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // Scheduled EventBridge keepalive: open a real database connection so the
  // Atlas free cluster registers activity and is not auto-paused.
  if ((event as KeepaliveEvent).source === KEEPALIVE_EVENT_SOURCE) {
    await pingDatabase();
    // lambdaDetected doubles as a canary for the runtime detection that
    // gates process.exit on connection failures.
    return { ok: true, lambdaDetected: IS_LAMBDA };
  }

  return serverlessApp(event as APIGatewayProxyEvent, context, () => undefined);
};
