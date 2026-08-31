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

// TTL: Mongo removes each counter when its window ends.
RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitModel = mongoose.model<IRateLimitDocument>(
  "RateLimit",
  RateLimitSchema,
);
