import mongoose from "mongoose";

import { ENVIRONMENT } from "../shared/constants";
import logger from "../shared/logger";

// Without this, queries issued while disconnected are buffered for 10s and
// fail with an opaque "Operation `users.findOne()` buffering timed out"
// instead of a real connection error.
mongoose.set("bufferCommands", false);

const SERVER_SELECTION_TIMEOUT_MS = 5000;

// Atlas M0 caps ~500 connections cluster-wide; the driver default of 100 per
// process can exhaust it with a handful of warm Lambda instances.
const MAX_POOL_SIZE = process.env.AWS_LAMBDA_FUNCTION_NAME ? 5 : 10;

let connecting: Promise<void> | null = null;

/**
 * Connects to MongoDB. Idempotent: resolves immediately when already
 * connected, reuses the in-flight attempt when one is running, and allows
 * a fresh retry after a failed attempt (important in Lambda, where the
 * process outlives a failed cold-start connection).
 */
/**
 * Builds the declared indexes once the connection is up.
 *
 * Mongoose's own `autoIndex` cannot do this here: with `bufferCommands`
 * disabled and a lazy connection, the automatic `Model.init()` fires while the
 * socket is still closed, throws on an undefined db handle, and the rejection
 * is swallowed — so NO index was ever created, silently. That left every
 * unique constraint unenforced (duplicate emails, two default accounts...).
 * A failure here is logged loudly rather than ignored.
 */
async function buildIndexes(): Promise<void> {
  const models = Object.values(mongoose.models);
  const results = await Promise.allSettled(
    models.map((model) => model.createIndexes()),
  );
  const failed = results.flatMap((result, i) =>
    result.status === "rejected"
      ? [{ model: models[i].modelName, err: result.reason }]
      : [],
  );
  if (failed.length > 0) {
    for (const { model, err } of failed) {
      logger.error(
        { err, model },
        "Index build failed; constraint NOT enforced",
      );
    }
    return;
  }
  logger.debug({ models: models.length }, "Indexes in sync");
}

export function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState === mongoose.STATES.connected) {
    return Promise.resolve();
  }
  if (!connecting) {
    const uri = (ENVIRONMENT as { MONGO_URI: string }).MONGO_URI;
    connecting = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
        maxPoolSize: MAX_POOL_SIZE,
        // Off in production; indexes are built by the db:sync-indexes deploy step.
        autoIndex: ENVIRONMENT.NODE_ENV !== "production",
      })
      .then(async () => {
        logger.info("Connected to MongoDB");
        if (ENVIRONMENT.NODE_ENV !== "production") {
          await buildIndexes();
        }
      })
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  return connecting;
}
