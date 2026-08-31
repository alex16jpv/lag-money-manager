import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";

import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";

const HEADER_NAME = "x-api-secret";

export const gatewaySecretMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const secret = ENVIRONMENT.API_SECRET;

  if (!secret) {
    // Fail closed in production (missing secret = misconfiguration).
    if (ENVIRONMENT.NODE_ENV === "production") {
      throw new ApiError("InternalServerError", "Server misconfiguration");
    }
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
