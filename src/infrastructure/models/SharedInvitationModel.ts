import mongoose, { Schema } from "mongoose";

import {
  Color,
  COLORS,
  INVITATION_STATUSES,
  InvitationStatus,
  MODEL_NAMES,
} from "../../shared/constants";

export interface ISharedInvitationDocument {
  _id: string;
  userId: string;
  groupId: string;
  contactId: string;
  email: string;
  status: InvitationStatus;
  // Present, and true, only while the invitation is live: waiting or joined.
  open?: true;
  expiresAt: Date;
  inviteeId?: string;
  answeredAt: Date | null;
  withdrawnAt: Date | null;
  groupName: string;
  groupColor?: Color;
  groupCurrency: string;
  inviterName: string;
  inviterEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

const SharedInvitationSchema = new Schema<ISharedInvitationDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    groupId: { type: String, required: true },
    contactId: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: Object.keys(INVITATION_STATUSES),
    },
    open: { type: Boolean, required: false },
    expiresAt: { type: Date, required: true },
    inviteeId: { type: String, required: false },
    answeredAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
    groupName: { type: String, required: true },
    groupColor: { type: String, required: false, enum: Object.keys(COLORS) },
    groupCurrency: { type: String, required: true },
    inviterName: { type: String, required: true },
    inviterEmail: { type: String, required: true },
  },
  { timestamps: true },
);

// One live invitation per person per group: two concurrent invites meet here, not in a read.
SharedInvitationSchema.index(
  { groupId: 1, contactId: 1 },
  { unique: true, partialFilterExpression: { open: true } },
);
SharedInvitationSchema.index({ userId: 1, groupId: 1, _id: 1 });
SharedInvitationSchema.index({ userId: 1, contactId: 1 });
SharedInvitationSchema.index({ userId: 1, status: 1, expiresAt: 1 });
SharedInvitationSchema.index({ email: 1, status: 1, expiresAt: 1, _id: 1 });

// Change feed: the inviter's rows, and the invited person's by address and, once answered, by id.
SharedInvitationSchema.index({ userId: 1, updatedAt: 1, _id: 1 });
SharedInvitationSchema.index({ email: 1, updatedAt: 1, _id: 1 });
SharedInvitationSchema.index(
  { inviteeId: 1, updatedAt: 1, _id: 1 },
  { partialFilterExpression: { inviteeId: { $exists: true } } },
);

export const SharedInvitationModel = mongoose.model<ISharedInvitationDocument>(
  MODEL_NAMES.SHARED_INVITATION,
  SharedInvitationSchema,
);
