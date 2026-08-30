import { DB_TYPES, ENVIRONMENT } from "../shared/constants";
import logger from "../shared/logger";

/**
 * Opens a connection to the configured database and runs a trivial command.
 * Used by /health/db and by the scheduled keepalive that stops MongoDB Atlas
 * free clusters from being auto-paused for inactivity.
 */
export async function pingDatabase(): Promise<void> {
  if (ENVIRONMENT.DB_TYPE === DB_TYPES.MONGO) {
    const { connectMongo } = await import("./mongoConnection");
    const mongoose = (await import("mongoose")).default;
    await connectMongo();
    await mongoose.connection.db!.admin().ping();
  } else {
    const sequelize = (await import("./sequelizeConnection")).default;
    await sequelize.authenticate();
  }
  logger.info("Database ping OK");
}
