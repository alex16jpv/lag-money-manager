import { NextFunction,Request, Response } from "express";

import { DomainValidationError } from "../../domain/errors";
import { ApiError } from "../../shared/errors";
import { errorMiddleware } from "../../shared/middlewares";

jest.mock("../../shared/logger", () => ({
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
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
    req = { headers: {} } as Request;
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
    });
  });

  it("should handle ApiError with details", () => {
    const error = new ApiError("BadRequest", "Validation failed", undefined, {
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
      code: "VALIDATION",
      details: [{ field: "name", message: "'name' is required" }],
    });
  });

  it("should handle DomainValidationError without field", () => {
    const error = new DomainValidationError("Invalid data");

    errorMiddleware(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "ValidationError",
      message: "Invalid data",
      code: "VALIDATION",
      details: [{ field: "", message: "Invalid data" }],
    });
  });

  it("should return generic 500 for unknown errors without leaking message", () => {
    const error = new Error("Sensitive internal details");

    errorMiddleware(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "InternalServerError",
      message: "An unexpected error occurred",
      code: "INTERNAL",
    });
  });

  it("should handle MongoServerError duplicate key (code 11000)", () => {
    const error = Object.assign(new Error("E11000 duplicate key"), {
      name: "MongoServerError",
      code: 11000,
      keyValue: { email: "test@test.com" },
    });

    errorMiddleware(error as Error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: "ConflictError",
      message: "Duplicate value for: email",
      code: "DUPLICATE",
    });
  });

  it("should handle CastError from Mongoose", () => {
    const error = Object.assign(new Error("Cast to ObjectId failed"), {
      name: "CastError",
    });

    errorMiddleware(error as Error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "ValidationError",
      message: "Invalid ID format",
      code: "INVALID_ID",
    });
  });
});
