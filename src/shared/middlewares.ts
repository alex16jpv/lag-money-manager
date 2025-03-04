import { NextFunction, Request, Response } from "express";
import { ApiError } from "./errors";

export const errorMiddleware = (
  error: Error,
  _: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: error.name,
      message: error.message,
      details: error?.details,
    });
    return;
  }
  res.status(500).json({
    error: "InternalServerError",
    message: error.message,
  });
};
