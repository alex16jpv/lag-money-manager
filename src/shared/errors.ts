class BaseError extends Error {
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ApiError extends BaseError {
  static errors = {
    BadRequest: 400,
    Unauthorized: 401,
    NotFound: 404,
    UnprocessableEntity: 422,
    InternalServerError: 500,
  };

  constructor(
    name: keyof typeof ApiError.errors,
    message?: string,
    details?: Record<string, unknown>
  ) {
    super(message || name, ApiError.errors[name], details);
    this.name = name + "Error";
  }
}

export class CustomError extends BaseError {
  constructor({
    message,
    statusCode = 500,
    details,
  }: {
    message: string;
    statusCode?: number;
    details?: Record<string, unknown>;
  }) {
    super(message, statusCode, details);
    this.name = "Error";
  }
}
