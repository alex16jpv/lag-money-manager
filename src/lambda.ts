import serverlessExpress from "@codegenie/serverless-express";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";

import app from "./app";
import { createNightlyPassService } from "./app/factories/nightlyPassFactory";
import { pingDatabase } from "./config/dbHealth";
import { IS_LAMBDA } from "./shared/constants";
import logger from "./shared/logger";

const serverlessApp = serverlessExpress({ app });

export const KEEPALIVE_EVENT_SOURCE = "lag.keepalive";

type KeepaliveEvent = { source?: string };

// Under the Lambda's 15 s: the pass stops starting work with this much of the invocation left.
const NIGHTLY_PASS_MAX_MS = 10_000;
const NIGHTLY_PASS_RESERVE_MS = 3_000;

export const handler = async (
  event: APIGatewayProxyEvent | KeepaliveEvent,
  context: Context,
) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // Opens a real connection so the Atlas free cluster registers activity and is not auto-paused.
  if ((event as KeepaliveEvent).source === KEEPALIVE_EVENT_SOURCE) {
    await pingDatabase();
    try {
      await createNightlyPassService().run(
        Math.min(
          NIGHTLY_PASS_MAX_MS,
          context.getRemainingTimeInMillis() - NIGHTLY_PASS_RESERVE_MS,
        ),
      );
    } catch (err) {
      logger.error(
        { err, code: "NIGHTLY_PASS_FAILED" },
        "The nightly pass stopped: deleted accounts and deadline emails wait for the next one",
      );
    }
    // Doubles as a canary for the runtime detection that gates process.exit on failures.
    return { ok: true, lambdaDetected: IS_LAMBDA };
  }

  return serverlessApp(event as APIGatewayProxyEvent, context, () => undefined);
};
