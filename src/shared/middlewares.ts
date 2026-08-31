import { NextFunction, Request, Response } from "express";

import { DomainValidationError } from "../domain/errors";
import { ApiError } from "./errors";
import logger from "./logger";

const MONGO_UNAVAILABLE_ERROR_NAMES = new Set([
  "MongooseServerSelectionError",
  "MongoServerSelectionError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
]);

function isDatabaseUnavailableError(error: Error): boolean {
  return (
    MONGO_UNAVAILABLE_ERROR_NAMES.has(error?.name) ||
    (error?.name === "MongooseError" &&
      /buffering timed out|before initial connection/.test(error.message))
  );
}

interface MongoServerError extends Error {
  code: number;
  keyValue?: Record<string, unknown>;
}

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: error.name,
      message: error.message,
      ...(error.code && { code: error.code }),
      ...(error.details !== undefined && { details: error.details }),
    });
    return;
  }

  if (error instanceof DomainValidationError) {
    // Same shape as the Zod path: details is always [{field, message}].
    res.status(400).json({
      error: "ValidationError",
      message: error.message,
      code: error.code ?? "VALIDATION",
      details: [{ field: error.field ?? "", message: error.message }],
    });
    return;
  }

  // MongoDB duplicate key (code 11000)
  if (
    error?.name === "MongoServerError" &&
    (error as MongoServerError).code === 11000
  ) {
    const keyValue = (error as MongoServerError).keyValue;
    const fields = keyValue ? Object.keys(keyValue).join(", ") : "unknown";
    res.status(409).json({
      error: "ConflictError",
      message: `Duplicate value for: ${fields}`,
      code: "DUPLICATE",
    });
    return;
  }

  // Mongoose CastError (invalid ObjectId / type mismatch)
  if (error?.name === "CastError") {
    res.status(400).json({
      error: "ValidationError",
      message: "Invalid ID format",
      code: "INVALID_ID",
    });
    return;
  }

  if (isDatabaseUnavailableError(error)) {
    logger.error(
      { err: error, requestId: req.headers["x-request-id"] },
      "Database unavailable",
    );
    res.status(503).json({
      error: "ServiceUnavailableError",
      message: "Database connection unavailable, please try again later",
      code: "DB_UNAVAILABLE",
    });
    return;
  }

  logger.error(
    { err: error, requestId: req.headers["x-request-id"] },
    "Unhandled error",
  );

  res.status(500).json({
    error: "InternalServerError",
    message: "An unexpected error occurred",
    code: "INTERNAL",
  });
};
