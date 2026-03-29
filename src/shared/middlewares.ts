import { NextFunction, Request, Response } from "express";
import { ApiError } from "./errors";
import { DomainValidationError } from "../domain/errors";
import logger from "./logger";

interface ValidationError extends Error {
  errors: { message: string }[];
  fields: string[];
}

export const errorMiddleware = (
  error: Error,
  _: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: error.name,
      message: error.message,
      details: error?.details,
    });
    return;
  }

  if (error instanceof DomainValidationError) {
    res.status(400).json({
      error: "ValidationError",
      message: error.message,
      ...(error.field && { details: { field: error.field } }),
    });
    return;
  }

  if (
    error?.name === "SequelizeUniqueConstraintError" &&
    (error as ValidationError)?.errors?.length > 0
  ) {
    res.status(400).json({
      error: "ValidationError",
      message: (error as ValidationError).errors
        ?.map((err: { message: string }) => err.message)
        ?.join(", "),
    });
    return;
  }

  if (error?.name === "SequelizeForeignKeyConstraintError") {
    res.status(400).json({
      error: "ValidationError",
      message: "Foreign key constraint error",
      details: { fields: (error as ValidationError).fields?.join(", ") },
    });
    return;
  }

  logger.error({ err: error }, "Unhandled error");

  res.status(500).json({
    error: "InternalServerError",
    message: "An unexpected error occurred",
  });
};
