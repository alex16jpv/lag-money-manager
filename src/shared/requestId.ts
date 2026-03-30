import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};
