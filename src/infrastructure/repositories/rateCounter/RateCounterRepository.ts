import {
  CounterWindow,
  IRateCounterRepository,
  RateCount,
} from "../../../domain/repositories/rateCounter/IRateCounterRepository";
import { RateLimitModel } from "../../models/RateLimitModel";

export class RateCounterRepository implements IRateCounterRepository {
  async hit(key: string, window: CounterWindow): Promise<RateCount> {
    const nextExpiry =
      "lengthMs" in window
        ? { $add: ["$$NOW", window.lengthMs] }
        : { $literal: window.endsAt };
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
                nextExpiry,
                "$expiresAt",
              ],
            },
          },
        },
      ],
      // Mongoose 9 refuses a pipeline without this, and a limiter built on it would count nothing.
      { upsert: true, returnDocument: "after", updatePipeline: true },
    ).lean();
    if (!doc) {
      throw new Error(`Rate counter ${key} returned no document`);
    }
    return { count: doc.count, expiresAt: doc.expiresAt };
  }

  async refund(key: string): Promise<void> {
    // count > 0 floors at 0: a refund landing in a fresh window must not go negative.
    await RateLimitModel.updateOne(
      { _id: key, count: { $gt: 0 } },
      { $inc: { count: -1 } },
    ).exec();
  }
}
