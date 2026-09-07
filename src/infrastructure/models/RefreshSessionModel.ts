import mongoose, { Schema } from "mongoose";

export interface IRefreshSessionDocument {
  _id: string; // jti of the refresh token
  userId: string;
  // Root jti of the rotation chain; reuse of a rotated token revokes the family.
  familyId: string;
  // Absolute family expiry: rotation never extends it (TTL cleans the family).
  expiresAt: Date;
  replacedBy: string | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  userAgent?: string;
  createdAt: Date;
}

const RefreshSessionSchema = new Schema<IRefreshSessionDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    replacedBy: { type: String, default: null },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    userAgent: { type: String, required: false },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshSessionModel = mongoose.model<IRefreshSessionDocument>(
  "RefreshSession",
  RefreshSessionSchema,
);
