import { NextFunction, Request, Response } from "express";

import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import logger from "../../shared/logger";

interface AuthRateLimitOptions {
  keyPrefix: string;
  max: number;
  windowMs: number;
  // Defaults to the client IP; return null to skip limiting this request.
  keyFrom?: (req: Request) => string | null;
  // Refund on success so a per-account counter cannot lock the real owner out, nor punish real logins.
  refundOnSuccess?: boolean;
}

// Backed by MongoDB so the limit holds across Lambda instances. Fails open on store errors.
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
      // One atomic op: on upsert $expiresAt is missing, sorts below $$NOW, so a fresh doc starts at 1.
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
        // Mongoose 9 refuses a pipeline without this, and the limiter fails open: no auth limit at all.
        { upsert: true, new: true, updatePipeline: true },
      ).lean();

      if (refundOnSuccess) {
        // Refund BEFORE replying: on Lambda the container can freeze right after, losing later writes.
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
