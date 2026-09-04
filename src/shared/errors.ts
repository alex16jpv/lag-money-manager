import { ErrorCode } from "./errorCodes";

class BaseError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ApiError extends BaseError {
  static errors = {
    BadRequest: 400,
    Unauthorized: 401,
    Forbidden: 403,
    NotFound: 404,
    Conflict: 409,
    UnprocessableEntity: 422,
    InternalServerError: 500,
  };

  // Stable machine-readable code; clients branch on this, never on `message`.
  code?: ErrorCode;

  constructor(
    name: keyof typeof ApiError.errors,
    message?: string,
    code?: ErrorCode,
    details?: unknown,
  ) {
    super(message || name, ApiError.errors[name], details);
    this.name = name + "Error";
    this.code = code;
  }
}

/**
 * A write whose `If-Match` no longer matches the stored version. Carries the
 * resource as the server has it so the client can show both sides without a
 * second request.
 */
export class StaleUpdateError extends ApiError {
  constructor(public current: unknown) {
    super(
      "Conflict",
      "The resource changed since you last read it",
      "STALE_UPDATE",
    );
  }
}
