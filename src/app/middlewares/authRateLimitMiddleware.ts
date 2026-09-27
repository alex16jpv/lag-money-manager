import { NextFunction, Request, Response } from "express";

import { RateCounterRepository } from "../../infrastructure/repositories/rateCounter/RateCounterRepository";
import logger from "../../shared/logger";
import { clientIp } from "./clientIp";

interface AuthRateLimitOptions {
  keyPrefix: string;
  max: number;
  windowMs: number;
  // Defaults to the client IP; return null to skip limiting this request.
  keyFrom?: (req: Request) => string | null;
  // Refund on success so a per-account counter cannot lock the real owner out, nor punish real logins.
  refundOnSuccess?: boolean;
}

const rateCounters = new RateCounterRepository();

// Backed by MongoDB so the limit holds across Lambda instances. Fails open on store errors.
export function authRateLimit(options: AuthRateLimitOptions) {
  const { keyPrefix, max, windowMs, keyFrom, refundOnSuccess } = options;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const subject = keyFrom ? keyFrom(req) : clientIp(req) || "unknown";
    if (!subject) {
      next();
      return;
    }
    const key = `${keyPrefix}:${subject}`;

    try {
      const counted = await rateCounters.hit(key, { lengthMs: windowMs });

      if (refundOnSuccess) {
        // Refund BEFORE replying: on Lambda the container can freeze right after, losing later writes.
        const originalJson = res.json.bind(res);
        res.json = ((body?: unknown) => {
          if (res.statusCode >= 400) {
            return originalJson(body);
          }
          res.json = originalJson;
          rateCounters
            .refund(key)
            .catch(() => {
              /* best-effort refund */
            })
            .finally(() => originalJson(body));
          return res;
        }) as typeof res.json;
      }

      if (counted.count > max) {
        const retryAfter = Math.max(
          1,
          Math.ceil((counted.expiresAt.getTime() - Date.now()) / 1000),
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
