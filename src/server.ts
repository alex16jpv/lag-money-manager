import "dotenv/config";
import app from "./app";
import { ENVIRONMENT } from "./shared/constants";
import logger from "./shared/logger";

const port = ENVIRONMENT.PORT;

app.listen(port, (error?: Error) => {
  if (error) {
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
  logger.info(`App listening on port ${port}`);
});
