/**
 * The limiters count with an aggregation pipeline, and the auth one fails open
 * on a store error — so when Mongoose 9 started refusing pipelines without
 * `updatePipeline`, the limit silently stopped applying. The unit tests mock
 * the model, so only a real database can catch this class of bug.
 *
 * Skips when there is no local replica set on the machine.
 */
import mongoose from "mongoose";

import { RateCounterRepository } from "../../infrastructure/repositories/rateCounter/RateCounterRepository";

const TEST_URI =
  "mongodb://localhost:27017/lag_ratelimit_itest?replicaSet=rs0&directConnection=true";

describe("rate limit store", () => {
  let available = false;
  const counters = new RateCounterRepository();
  const sliding: number[] = [];
  const fixed: { count: number; expiresAt: Date }[] = [];
  const endsAt = new Date(Date.now() + 3_600_000);
  let afterRefunds = 0;
  let restarted = 0;

  beforeAll(async () => {
    try {
      await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 1500 });
      available = true;
    } catch {
      return;
    }

    for (let i = 0; i < 3; i++) {
      sliding.push((await counters.hit("probe", { lengthMs: 900_000 })).count);
    }
    for (let i = 0; i < 2; i++) {
      fixed.push(await counters.hit("probe-fixed", { endsAt }));
    }
    await counters.refund("probe-fixed");
    await counters.refund("probe-fixed");
    await counters.refund("probe-fixed");
    afterRefunds = (await counters.hit("probe-fixed", { endsAt })).count;

    await counters.hit("probe-ended", { endsAt: new Date(Date.now() - 1000) });
    restarted = (
      await counters.hit("probe-ended", { endsAt: new Date(Date.now() - 1000) })
    ).count;
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
    expect(sliding).toEqual([1, 2, 3]);
  });

  it("keeps a fixed window's end, and a refund never goes below zero", () => {
    if (!ran()) return;
    expect(fixed.map((f) => f.count)).toEqual([1, 2]);
    expect(fixed[0].expiresAt.getTime()).toBe(endsAt.getTime());
    expect(afterRefunds).toBe(1);
  });

  it("starts a window that already ended over at one", () => {
    if (!ran()) return;
    expect(restarted).toBe(1);
  });
});
