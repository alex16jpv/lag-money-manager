import { NextFunction, Request, Response } from "express";

import { RateLimitModel } from "../../domain/models/RateLimitModel";
import logger from "../../shared/logger";

interface AuthRateLimitOptions {
  keyPrefix: string;
  max: number;
  windowMs: number;
}

/**
 * Strict, per-IP rate limiter for authentication endpoints, backed by MongoDB.
 *
 * The global in-memory limiter (express-rate-limit) counts per Lambda instance,
 * so under concurrency its effective limit multiplies by the number of warm
 * containers and resets on cold starts — useless against brute force. This
 * limiter keeps the counter in the shared database, so the limit holds across
 * every instance. It is the zero-infrastructure alternative to API Gateway
 * usage plans / AWS WAF (both of which cost money) when serving from a Lambda
 * Function URL.
 *
 * Fails open on database errors: a rate-limit store outage must not take down
 * login itself.
 */
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
        // Start a fresh window.
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
