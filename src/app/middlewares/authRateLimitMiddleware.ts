import { NextFunction, Request, Response } from "express";

import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import logger from "../../shared/logger";

interface AuthRateLimitOptions {
  keyPrefix: string;
  max: number;
  windowMs: number;
  // Defaults to the client IP; return null to skip limiting this request.
  keyFrom?: (req: Request) => string | null;
}

// Per-key auth limiter backed by MongoDB so the limit holds across Lambda
// instances (the in-memory limiter counts per instance). Fails open on store errors.
export function authRateLimit(options: AuthRateLimitOptions) {
  const { keyPrefix, max, windowMs, keyFrom } = options;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const subject = keyFrom ? keyFrom(req) : (req.ip ?? "unknown");
    if (!subject) {
      next();
      return;
    }
    const key = `${keyPrefix}:${subject}`;

    try {
      // One atomic op (no read-then-write race): resets the window when it
      // expired, increments otherwise. On upsert $expiresAt is missing, which
      // compares lower than $$NOW, so a fresh doc starts at count 1.
      const doc = await RateLimitModel.findOneAndUpdate(
        { _id: key },
        [
          {
            $set: {
              count: {
                $cond: [
                  { $lte: ["$expiresAt", "$$NOW"] },
                  1,
                  { $add: [{ $ifNull: ["$count", 0] }, 1] },
                ],
              },
              expiresAt: {
                $cond: [
                  { $lte: ["$expiresAt", "$$NOW"] },
                  { $add: ["$$NOW", windowMs] },
                  "$expiresAt",
                ],
              },
            },
          },
        ],
        { upsert: true, new: true },
      ).lean();

      if (doc && doc.count > max) {
        const retryAfter = Math.max(
          1,
          Math.ceil((doc.expiresAt.getTime() - Date.now()) / 1000),
        );
        res.setHeader("Retry-After", String(retryAfter));
        res.status(429).json({
          error: "TooManyRequests",
          message: "Too many attempts, please try again later",
          code: "RATE_LIMITED",
        });
        return;
      }

      next();
    } catch (err) {
      logger.error({ err, key }, "Auth rate limiter store error; failing open");
      next();
    }
  };
}
