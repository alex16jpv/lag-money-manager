import mongoose from "mongoose";

import { ENVIRONMENT } from "../shared/constants";
import logger from "../shared/logger";

// Without this, queries while disconnected buffer for 10 s and fail with an opaque timeout.
mongoose.set("bufferCommands", false);

const SERVER_SELECTION_TIMEOUT_MS = 5000;

// Atlas M0 caps ~500 connections, and the driver's 100 per process exhausts it with a few Lambdas.
const MAX_POOL_SIZE = process.env.AWS_LAMBDA_FUNCTION_NAME ? 5 : 10;

let connecting: Promise<void> | null = null;

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
  const attempt = async (
    models: mongoose.Model<unknown>[],
  ): Promise<{ model: mongoose.Model<unknown>; err: unknown }[]> => {
    const results = await Promise.allSettled(
      models.map((model) => model.createIndexes()),
    );
    return results.flatMap((result, i) =>
      result.status === "rejected"
        ? [{ model: models[i], err: result.reason }]
        : [],
    );
  };

  const all = Object.values(mongoose.models) as mongoose.Model<unknown>[];
  let failures = await attempt(all);

  // One retry for a flaky resolver (WSL, VPNs); data conflicts are not retried, they cannot resolve.
  const transient = failures.filter(
    (f) => (f.err as { code?: number })?.code !== 11000,
  );
  if (transient.length > 0) {
    const retried = await attempt(transient.map((f) => f.model));
    failures = failures
      .filter((f) => (f.err as { code?: number })?.code === 11000)
      .concat(retried);
  }

  const failed = failures.map((f) => ({
    model: f.model.modelName,
    err: f.err,
  }));
  for (const { model, err } of failed) {
    // A network blip leaves the index in an unknown state, so saying "NOT enforced" sends people hunting.
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
    logger.debug({ models: all.length }, "Indexes in sync");
  }
}

// Host only: the URI carries credentials and must never reach a log.
function hostOf(uri: string): string {
  return uri.replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, "").split(/[/,?]/)[0];
}

/**
 * Connects to MongoDB. Idempotent: resolves immediately when already
 * connected, reuses the in-flight attempt when one is running, and allows
 * a fresh retry after a failed attempt (important in Lambda, where the
 * process outlives a failed cold-start connection).
 */
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
        logger.info({ host: hostOf(uri) }, "Connected to MongoDB");
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
