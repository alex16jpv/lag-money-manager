import { NextFunction, Request, Response } from "express";

import { DomainValidationError } from "../domain/errors";
import { ApiError, StaleUpdateError } from "./errors";
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

// body-parser rejects a malformed or oversized body before any route runs.
// Its errors carry their own 4xx status, which must not be reported as a 500:
// the client sent something wrong, the server did not break.
interface BodyParserError extends Error {
  type: string;
  statusCode: number;
  expose: boolean;
}

const BODY_PARSER_CODES: Record<string, string> = {
  "entity.parse.failed": "MALFORMED_JSON",
  "entity.too.large": "PAYLOAD_TOO_LARGE",
  "encoding.unsupported": "UNSUPPORTED_ENCODING",
  "request.aborted": "REQUEST_ABORTED",
};

function asBodyParserError(error: Error): BodyParserError | null {
  const candidate = error as Partial<BodyParserError>;
  return typeof candidate.type === "string" &&
    candidate.expose === true &&
    typeof candidate.statusCode === "number" &&
    candidate.statusCode >= 400 &&
    candidate.statusCode < 500
    ? (error as BodyParserError)
    : null;
}

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // Picked up by requestLogMiddleware so the completion line says WHY.
  const logWhy = (code: string | undefined, message: string): void => {
    res.locals.errorCode = code;
    res.locals.errorMessage = message;
  };
  if (error instanceof ApiError) {
    logWhy(error.code, error.message);
    res.status(error.statusCode).json({
      error: error.name,
      message: error.message,
      ...(error.code && { code: error.code }),
      ...(error.details !== undefined && { details: error.details }),
      // The server's version of the resource, so a stale write can be resolved
      // without a second round trip.
      ...(error instanceof StaleUpdateError && { current: error.current }),
    });
    return;
  }

  if (error instanceof DomainValidationError) {
    logWhy(error.code ?? "VALIDATION", error.message);
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
    logWhy("DUPLICATE", `Duplicate value for: ${fields}`);
    res.status(409).json({
      error: "ConflictError",
      message: `Duplicate value for: ${fields}`,
      code: "DUPLICATE",
    });
    return;
  }

  // Mongoose CastError (invalid ObjectId / type mismatch)
  if (error?.name === "CastError") {
    logWhy("INVALID_ID", "Invalid ID format");
    res.status(400).json({
      error: "ValidationError",
      message: "Invalid ID format",
      code: "INVALID_ID",
    });
    return;
  }

  if (isDatabaseUnavailableError(error)) {
    logWhy("DB_UNAVAILABLE", error.message);
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

  const bodyError = asBodyParserError(error);
  if (bodyError) {
    const code = BODY_PARSER_CODES[bodyError.type] ?? "BAD_REQUEST";
    logWhy(code, bodyError.message);
    res.status(bodyError.statusCode).json({
      error: "BadRequestError",
      message:
        code === "MALFORMED_JSON"
          ? "Request body is not valid JSON"
          : bodyError.message,
      code,
    });
    return;
  }

  logWhy("INTERNAL", error.message);
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
