import { DomainValidationError } from "../domain/errors";
import { ErrorCode } from "./errorCodes";
import { ApiError, StaleUpdateError } from "./errors";

/** The body every error answer has; `current` only rides on STALE_UPDATE. */
export interface ErrorBody {
  error: string;
  message: string;
  code?: ErrorCode;
  details?: unknown;
  current?: unknown;
}

export interface DescribedFailure {
  status: number;
  body: ErrorBody;
}

interface MongoServerError extends Error {
  code: number;
  keyValue?: Record<string, unknown>;
}

/**
 * The client-fault errors, translated the one way the API translates them.
 * `errorMiddleware` answers HTTP with this; `POST /sync` files the same body
 * under the operation that caused it, which is what keeps "the same codes as
 * the normal endpoints" true by construction. Anything else (a database
 * outage, a bug) is null here: it is not the client's, and not per-operation.
 */
export function describeFailure(error: Error): DescribedFailure | null {
  if (error instanceof ApiError) {
    return {
      status: error.statusCode,
      body: {
        error: error.name,
        message: error.message,
        ...(error.code && { code: error.code }),
        ...(error.details !== undefined && { details: error.details }),
        // The server's version of the resource, so a stale write can be
        // resolved without a second round trip.
        ...(error instanceof StaleUpdateError && { current: error.current }),
      },
    };
  }

  if (error instanceof DomainValidationError) {
    // Same shape as the Zod path: details is always [{field, message}].
    return {
      status: 400,
      body: {
        error: "ValidationError",
        message: error.message,
        code: error.code ?? "VALIDATION",
        details: [{ field: error.field ?? "", message: error.message }],
      },
    };
  }

  // MongoDB duplicate key (code 11000)
  if (
    error?.name === "MongoServerError" &&
    (error as MongoServerError).code === 11000
  ) {
    const keyValue = (error as MongoServerError).keyValue;
    const fields = keyValue ? Object.keys(keyValue).join(", ") : "unknown";
    return {
      status: 409,
      body: {
        error: "ConflictError",
        message: `Duplicate value for: ${fields}`,
        code: "DUPLICATE",
      },
    };
  }

  // Mongoose CastError (invalid ObjectId / type mismatch)
  if (error?.name === "CastError") {
    return {
      status: 400,
      body: {
        error: "ValidationError",
        message: "Invalid ID format",
        code: "INVALID_ID",
      },
    };
  }

  return null;
}
