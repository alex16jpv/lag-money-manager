import { NextFunction, Request, Response } from "express";
import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import { timingSafeEqual } from "crypto";

const HEADER_NAME = "x-api-secret";

export const gatewaySecretMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const secret = ENVIRONMENT.API_SECRET;

  if (!secret) {
    next();
    return;
  }

  const headerValue = req.headers[HEADER_NAME];

  if (
    typeof headerValue !== "string" ||
    !safeEqual(headerValue, secret)
  ) {
    throw new ApiError("Forbidden", "Access denied");
  }

  next();
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
