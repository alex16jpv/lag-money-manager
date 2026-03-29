import { Request, Response, NextFunction } from "express";
import { errorMiddleware } from "../../shared/middlewares";
import { ApiError } from "../../shared/errors";
import { DomainValidationError } from "../../domain/errors";

jest.mock("../../shared/logger", () => ({
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const createMockRes = (): jest.Mocked<Response> => {
  const res = {} as jest.Mocked<Response>;
  res.status = jest.fn().mockReturnThis();
  res.json = jest.fn().mockReturnThis();
  return res;
};

describe("errorMiddleware", () => {
  let req: Request;
  let res: jest.Mocked<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {} as Request;
    res = createMockRes();
    next = jest.fn();
  });

  it("should handle ApiError with correct status and message", () => {
    const error = new ApiError("NotFound", "User not found");

    errorMiddleware(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "NotFoundError",
      message: "User not found",
      details: undefined,
    });
  });

  it("should handle ApiError with details", () => {
    const error = new ApiError("BadRequest", "Validation failed", {
      field: "email",
    });

    errorMiddleware(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "BadRequestError",
      message: "Validation failed",
      details: { field: "email" },
    });
  });

  it("should handle DomainValidationError with field", () => {
    const error = new DomainValidationError("'name' is required", "name");

    errorMiddleware(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "ValidationError",
      message: "'name' is required",
      details: { field: "name" },
    });
  });

  it("should handle DomainValidationError without field", () => {
    const error = new DomainValidationError("Invalid data");

    errorMiddleware(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "ValidationError",
      message: "Invalid data",
    });
  });

  it("should handle SequelizeUniqueConstraintError", () => {
    const error = Object.assign(new Error("Validation error"), {
      name: "SequelizeUniqueConstraintError",
      errors: [
        { message: "email must be unique" },
        { message: "name must be unique" },
      ],
    });

    errorMiddleware(error as Error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "ValidationError",
      message: "email must be unique, name must be unique",
    });
  });

  it("should handle SequelizeForeignKeyConstraintError", () => {
    const error = Object.assign(new Error("FK error"), {
      name: "SequelizeForeignKeyConstraintError",
      fields: ["userId"],
    });

    errorMiddleware(error as Error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "ValidationError",
      message: "Foreign key constraint error",
      details: { fields: "userId" },
    });
  });

  it("should return generic 500 for unknown errors without leaking message", () => {
    const error = new Error("Sensitive internal details");

    errorMiddleware(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "InternalServerError",
      message: "An unexpected error occurred",
    });
  });
});
