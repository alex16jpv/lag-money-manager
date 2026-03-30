import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

const VALID_REQUEST_ID = /^[a-zA-Z0-9\-_]{1,64}$/;

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const clientId = req.headers["x-request-id"] as string;
  const requestId =
    clientId && VALID_REQUEST_ID.test(clientId) ? clientId : randomUUID();
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};
