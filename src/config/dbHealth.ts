import logger from "../shared/logger";

/**
 * Opens a connection to MongoDB and runs a trivial command. Used by
 * /health/db and by the scheduled keepalive that stops MongoDB Atlas free
 * clusters from being auto-paused for inactivity.
 */
export async function pingDatabase(): Promise<void> {
  const { connectMongo } = await import("./mongoConnection");
  const mongoose = (await import("mongoose")).default;
  await connectMongo();
  await mongoose.connection.db!.admin().ping();
  logger.info("Database ping OK");
}
