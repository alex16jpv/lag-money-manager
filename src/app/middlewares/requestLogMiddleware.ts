import { NextFunction, Request, Response } from "express";

import logger from "../../shared/logger";

// Probe endpoints (keepalive/monitoring) log at debug when healthy so they
// don't drown real traffic; their failures still log at full level.
const QUIET_PATHS = new Set(["/", "/health/db"]);

/**
 * One completion line per request: method, path, status, duration, requestId
 * and — when the error middleware attached them — the machine-readable error
 * code and message. Without this, rejected requests (e.g. a 403 from the
 * gateway secret) leave no trace at all.
 */
export const requestLogMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startNs = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs =
      Math.round(Number(process.hrtime.bigint() - startNs) / 1e5) / 10;
    const fields = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      requestId: req.headers["x-request-id"],
      ...(res.locals.errorCode !== undefined && {
        code: res.locals.errorCode,
      }),
      ...(res.locals.errorMessage !== undefined && {
        errorMessage: res.locals.errorMessage,
      }),
      ...(req.user && { userId: req.user.userId }),
    };

    if (res.statusCode >= 500) {
      logger.error(fields, "request failed");
    } else if (res.statusCode >= 400) {
      logger.warn(fields, "request rejected");
    } else if (QUIET_PATHS.has(req.path)) {
      logger.debug(fields, "request completed");
    } else {
      logger.info(fields, "request completed");
    }
  });

  next();
};
