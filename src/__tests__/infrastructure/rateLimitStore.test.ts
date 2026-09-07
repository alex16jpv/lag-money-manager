/**
 * The auth limiter counts with an aggregation pipeline, and it fails open on a
 * store error — so when Mongoose 9 started refusing pipelines without
 * `updatePipeline`, the limit silently stopped applying. The unit tests mock
 * the model, so only a real database can catch this class of bug.
 *
 * Skips when there is no local replica set, which is what CI has.
 */
import mongoose from "mongoose";

const TEST_URI =
  "mongodb://localhost:27017/lag_ratelimit_itest?replicaSet=rs0&directConnection=true";

describe("rate limit store", () => {
  let available = false;
  const counts: number[] = [];

  beforeAll(async () => {
    try {
      await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 1500 });
      available = true;
    } catch {
      return;
    }

    const { RateLimitModel } =
      await import("../../infrastructure/models/RateLimitModel");
    // The exact shape authRateLimitMiddleware issues.
    for (let i = 0; i < 3; i++) {
      const doc = await RateLimitModel.findOneAndUpdate(
        { _id: "probe" },
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
                  { $add: ["$$NOW", 900_000] },
                  "$expiresAt",
                ],
              },
            },
          },
        ],
        { upsert: true, new: true, updatePipeline: true },
      ).lean();
      counts.push((doc as unknown as { count: number }).count);
    }
  }, 30_000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  const ran = (): boolean => {
    if (!available) {
      console.warn("SKIPPED: no MongoDB replica set on localhost:27017");
    }
    return available;
  };

  it("increments instead of throwing, so the limiter does not fail open", () => {
    if (!ran()) return;
    expect(counts).toEqual([1, 2, 3]);
  });
});
