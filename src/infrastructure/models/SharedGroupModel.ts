import mongoose, { Schema } from "mongoose";

import { NAME_COLLATION } from "../../shared/collation";
import {
  Color,
  COLORS,
  GROUP_SPLIT_MODES,
  GroupSplitMode,
  MODEL_NAMES,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";

export interface ISharedGroupDocument {
  _id: string;
  name: string;
  color?: Color;
  participants: { contactId: string | null; addedAt: Date }[];
  defaultSplit: {
    mode: GroupSplitMode;
    shares: { contactId: string | null; percent: number }[];
  };
  userId: string;
  currency: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ParticipantSchema = new Schema<
  ISharedGroupDocument["participants"][number]
>(
  {
    contactId: { type: String, default: null },
    addedAt: { type: Date, required: true },
  },
  { _id: false },
);

const DefaultSplitShareSchema = new Schema<
  ISharedGroupDocument["defaultSplit"]["shares"][number]
>(
  {
    contactId: { type: String, default: null },
    percent: { type: Number, required: true },
  },
  { _id: false },
);

const SharedGroupSchema = new Schema<ISharedGroupDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    color: { type: String, required: false, enum: Object.keys(COLORS) },
    participants: { type: [ParticipantSchema], required: true },
    defaultSplit: {
      mode: {
        type: String,
        required: true,
        enum: Object.keys(GROUP_SPLIT_MODES),
      },
      shares: { type: [DefaultSplitShareSchema], required: true, default: [] },
    },
    userId: { type: String, required: true },
    currency: {
      type: String,
      required: true,
      default: DEFAULT_CURRENCY,
      uppercase: true,
      trim: true,
    },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

SharedGroupSchema.index({ userId: 1, _id: 1 });
// One active name per user; collation strength 2 folds case, accents stay distinct.
SharedGroupSchema.index(
  { userId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { archivedAt: null },
    collation: NAME_COLLATION,
  },
);
// Answers "which groups is this contact in" without scanning the user's groups.
SharedGroupSchema.index({ userId: 1, "participants.contactId": 1 });

// Change feed: keyset over (updatedAt, _id), archived and deleted rows included.
SharedGroupSchema.index({ userId: 1, updatedAt: 1, _id: 1 });

export const SharedGroupModel = mongoose.model<ISharedGroupDocument>(
  MODEL_NAMES.SHARED_GROUP,
  SharedGroupSchema,
);
