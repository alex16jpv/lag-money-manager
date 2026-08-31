import mongoose, { Schema } from "mongoose";

export interface IIdempotencyKeyDocument {
  _id: string; // `${userId}:${key}`
  transactionId: string;
  createdAt: Date;
}

const IdempotencyKeySchema = new Schema<IIdempotencyKeyDocument>(
  {
    _id: { type: String, required: true },
    transactionId: { type: String, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

// TTL: keys expire 24h after creation.
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export const IdempotencyKeyModel = mongoose.model<IIdempotencyKeyDocument>(
  "IdempotencyKey",
  IdempotencyKeySchema,
);
