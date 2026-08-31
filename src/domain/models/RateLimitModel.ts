import mongoose, { Schema } from "mongoose";

export interface IRateLimitDocument {
  _id: string; // `${keyPrefix}:${ip}`
  count: number;
  expiresAt: Date;
}

const RateLimitSchema = new Schema<IRateLimitDocument>(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

// TTL index: MongoDB removes each counter automatically once its window ends,
// so the collection never grows and windows self-reset with no cron.
RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitModel = mongoose.model<IRateLimitDocument>(
  "RateLimit",
  RateLimitSchema,
);
