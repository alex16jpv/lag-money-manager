import { NextFunction, Request, Response } from "express";

import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import logger from "../../shared/logger";

interface AuthRateLimitOptions {
  keyPrefix: string;
  max: number;
  windowMs: number;
  // Defaults to the client IP; return null to skip limiting this request.
  keyFrom?: (req: Request) => string | null;
  // Refund the increment when the request succeeds (<400): the budget then
  // only burns on failures — a per-account login counter must not let a
  // third party lock the real owner out, nor punish legitimate logins.
  refundOnSuccess?: boolean;
}

// Per-key auth limiter backed by MongoDB so the limit holds across Lambda
// instances (the in-memory limiter counts per instance). Fails open on store errors.
export function authRateLimit(options: AuthRateLimitOptions) {
  const { keyPrefix, max, windowMs, keyFrom, refundOnSuccess } = options;

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
        // Mongoose 9 refuses an aggregation pipeline unless this says so, and
        // the limiter fails open on a store error — so without it there was no
        // auth rate limit at all.
        { upsert: true, new: true, updatePipeline: true },
      ).lean();

      if (refundOnSuccess) {
        // Refund BEFORE the response goes out: on Lambda the container can
        // freeze right after replying, losing any post-response write.
        const originalJson = res.json.bind(res);
        res.json = ((body?: unknown) => {
          if (res.statusCode >= 400) {
            return originalJson(body);
          }
          res.json = originalJson;
          // count > 0 floors at 0: a refund landing in a fresh window must not go negative.
          RateLimitModel.updateOne(
            { _id: key, count: { $gt: 0 } },
            { $inc: { count: -1 } },
          )
            .exec()
            .catch(() => {
              /* best-effort refund */
            })
            .finally(() => originalJson(body));
          return res;
        }) as typeof res.json;
      }

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
