import { NextFunction, Request, Response } from "express";

import { RateLimitModel } from "../../domain/models/RateLimitModel";
import logger from "../../shared/logger";

interface AuthRateLimitOptions {
  keyPrefix: string;
  max: number;
  windowMs: number;
}

// Per-IP auth limiter backed by MongoDB so the limit holds across Lambda
// instances (the in-memory limiter counts per instance). Fails open on store errors.
export function authRateLimit(options: AuthRateLimitOptions) {
  const { keyPrefix, max, windowMs } = options;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const ip = req.ip ?? "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    try {
      const existing = await RateLimitModel.findById(key).lean();

      if (!existing || existing.expiresAt.getTime() <= now) {
        await RateLimitModel.findByIdAndUpdate(
          key,
          { count: 1, expiresAt: new Date(now + windowMs) },
          { upsert: true },
        );
        next();
        return;
      }

      const updated = await RateLimitModel.findByIdAndUpdate(
        key,
        { $inc: { count: 1 } },
        { new: true },
      ).lean();

      if (updated && updated.count > max) {
        const retryAfter = Math.ceil(
          (existing.expiresAt.getTime() - now) / 1000,
        );
        res.setHeader("Retry-After", String(retryAfter));
        res.status(429).json({
          error: "TooManyRequests",
          message: "Too many attempts, please try again later",
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
