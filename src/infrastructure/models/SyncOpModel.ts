import mongoose, { Schema } from "mongoose";

import { SYNC_OP_STATUSES, SYNC_OP_TTL_SECONDS } from "../../shared/syncBatch";

// D-2: enough to answer a resent opId without applying it again, and nothing else.
export interface ISyncOpDocument {
  _id: string; // `${userId}:${opId}` — scoped so two users' opIds never collide
  userId: string;
  opId: string;
  status: string;
  entityId: string;
  code: string | null;
  createdAt: Date;
}

const SyncOpSchema = new Schema<ISyncOpDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    opId: { type: String, required: true },
    status: { type: String, required: true, enum: [...SYNC_OP_STATUSES] },
    entityId: { type: String, required: true },
    code: { type: String, default: null },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

// TTL: a resend after this is applied again, which client-minted ids and If-Match make safe.
SyncOpSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: SYNC_OP_TTL_SECONDS },
);

export const SyncOpModel = mongoose.model<ISyncOpDocument>(
  "SyncOp",
  SyncOpSchema,
);
