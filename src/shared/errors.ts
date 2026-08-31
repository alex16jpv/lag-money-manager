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
  code?: string;

  constructor(
    name: keyof typeof ApiError.errors,
    message?: string,
    code?: string,
    details?: unknown,
  ) {
    super(message || name, ApiError.errors[name], details);
    this.name = name + "Error";
    this.code = code;
  }
}
