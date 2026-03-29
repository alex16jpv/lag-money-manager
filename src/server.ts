import "dotenv/config";
import app from "./app";
import { ENVIRONMENT } from "./shared/constants";
import logger from "./shared/logger";

const port = ENVIRONMENT.PORT;

app.listen(port, () => {
  logger.info(`App listening on port ${port}`);
});
