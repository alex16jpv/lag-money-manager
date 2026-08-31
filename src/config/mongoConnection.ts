import mongoose from "mongoose";

import { ENVIRONMENT } from "../shared/constants";
import logger from "../shared/logger";

// Without this, queries issued while disconnected are buffered for 10s and
// fail with an opaque "Operation `users.findOne()` buffering timed out"
// instead of a real connection error.
mongoose.set("bufferCommands", false);

const SERVER_SELECTION_TIMEOUT_MS = 5000;

let connecting: Promise<void> | null = null;

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
        // Build indexes automatically on connect in every environment, the same
        // way collections are created on first write — no manual step. Mongoose
        // only creates missing indexes, so this is cheap and idempotent at this
        // scale. (`npm run db:sync-indexes` stays available as an optional
        // maintenance tool: unlike autoIndex, it also DROPS indexes you removed
        // from the schemas. If a collection ever grows huge, revisit turning
        // autoIndex off in production to avoid index builds under live traffic.)
        autoIndex: true,
      })
      .then(() => {
        logger.info("Connected to MongoDB");
      })
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  return connecting;
}
