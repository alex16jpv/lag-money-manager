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
  for (const { model, err } of failed) {
    // Data that violates the index is a real problem: the constraint is not
    // enforced and will not be until the offending rows are fixed. A network
    // blip is not — it leaves the index in an unknown, probably fine state,
    // and saying "NOT enforced" there sends people hunting a phantom.
    if ((err as { code?: number })?.code === 11000) {
      logger.error(
        { err, model },
        "Index rejected by existing data; constraint NOT enforced until the duplicates are removed",
      );
    } else {
      logger.warn(
        { err, model },
        "Could not verify indexes (database unreachable); run npm run db:sync-indexes if this persists",
      );
    }
  }
  if (failed.length === 0) {
    logger.debug({ models: models.length }, "Indexes in sync");
  }
}

// A development run pointed at a remote database writes test data straight
// into it. Cheap to say out loud, expensive to discover afterwards.
function warnIfDevelopmentPointsAtRemote(uri: string): void {
  if (ENVIRONMENT.NODE_ENV !== "development") return;
  const host = uri
    .replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, "")
    .split(/[/,?]/)[0];
  if (/^(localhost|127\.0\.0\.1|\[::1\]|mongo)(:\d+)?$/i.test(host)) return;
  logger.warn(
    { host },
    "NODE_ENV=development but MONGO_URI points at a remote database — local writes land there",
  );
}

export function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState === mongoose.STATES.connected) {
    return Promise.resolve();
  }
  if (!connecting) {
    const uri = (ENVIRONMENT as { MONGO_URI: string }).MONGO_URI;
    warnIfDevelopmentPointsAtRemote(uri);
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
