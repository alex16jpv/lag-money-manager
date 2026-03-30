import pino from "pino";
import { ENVIRONMENT } from "./constants";

const logger = pino({
  level: ENVIRONMENT.LOG_LEVEL,
  redact: ["req.headers.authorization", "*.password", "*.token"],
  ...(ENVIRONMENT.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});

export default logger;
