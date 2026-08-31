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
        // Off in production; indexes are built by the db:sync-indexes deploy step.
        autoIndex: ENVIRONMENT.NODE_ENV !== "production",
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
