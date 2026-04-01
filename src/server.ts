import "dotenv/config";
import app from "./app";
import { DB_TYPES, ENVIRONMENT } from "./shared/constants";
import logger from "./shared/logger";

const port = ENVIRONMENT.PORT;

const server = app.listen(port, (error?: Error) => {
  if (error) {
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
  logger.info(`App listening on port ${port}`);
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  try {
    if (ENVIRONMENT.DB_TYPE === DB_TYPES.MONGO) {
      const mongoose = await import("mongoose");
      await mongoose.default.disconnect();
      logger.info("MongoDB connection closed");
    } else {
      const sequelize = (await import("./config/sequelizeConnection")).default;
      await sequelize.close();
      logger.info("Sequelize connection closed");
    }
  } catch (err) {
    logger.error({ err }, "Error during database disconnect");
  }

  logger.info("Graceful shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
