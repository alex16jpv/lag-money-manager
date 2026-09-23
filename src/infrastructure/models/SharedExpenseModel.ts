import mongoose, { Schema } from "mongoose";

import {
  MODEL_NAMES,
  SHARE_PARTIES,
  SharePartyKind,
  SPLIT_MODES,
  SplitMode,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";

export interface ISharedShareDocument {
  party: SharePartyKind;
  contactId: string | null;
  percent: number | null;
  fixedAmount: number | null; // integer cents
  amount: number; // integer cents
  collected: number; // integer cents
}

export interface ISharedExpenseDocument {
  _id: string;
  groupId: string;
  description: string | null;
  date: Date;
  amount: number; // integer cents
  paidByContactId: string | null;
  split: {
    mode: SplitMode;
    guests: { count: number; name: string | null } | null;
    shares: ISharedShareDocument[];
  };
  customSplit: boolean;
  userId: string;
  currency: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ShareSchema = new Schema<ISharedShareDocument>(
  {
    party: { type: String, required: true, enum: Object.keys(SHARE_PARTIES) },
    contactId: { type: String, default: null },
    percent: { type: Number, default: null },
    fixedAmount: { type: Number, default: null },
    amount: { type: Number, required: true },
    collected: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const GuestBlockSchema = new Schema<
  NonNullable<ISharedExpenseDocument["split"]["guests"]>
>(
  {
    count: { type: Number, required: true },
    name: { type: String, default: null },
  },
  { _id: false },
);

const SharedExpenseSchema = new Schema<ISharedExpenseDocument>(
  {
    _id: { type: String, required: true },
    groupId: { type: String, required: true },
    description: { type: String, default: null },
    date: { type: Date, required: true },
    amount: { type: Number, required: true },
    paidByContactId: { type: String, default: null },
    split: {
      mode: { type: String, required: true, enum: Object.keys(SPLIT_MODES) },
      guests: { type: GuestBlockSchema, default: null },
      shares: { type: [ShareSchema], required: true },
    },
    customSplit: { type: Boolean, required: true, default: false },
    userId: { type: String, required: true },
    currency: {
      type: String,
      required: true,
      default: DEFAULT_CURRENCY,
      uppercase: true,
      trim: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The group's own list, newest expense first, and the aggregation behind its range and its totals.
SharedExpenseSchema.index({
  userId: 1,
  groupId: 1,
  deletedAt: 1,
  date: 1,
  _id: 1,
});
// Answers "does this contact have a share anywhere in the group" without scanning it.
SharedExpenseSchema.index({ userId: 1, "split.shares.contactId": 1 });

// Change feed: keyset over (updatedAt, _id), archived and deleted rows included.
SharedExpenseSchema.index({ userId: 1, updatedAt: 1, _id: 1 });
// The same keyset for whoever joined the group, which is not the owner.
SharedExpenseSchema.index({ groupId: 1, updatedAt: 1, _id: 1 });
// What a group held when you joined it, read in id order and a page at a time.
SharedExpenseSchema.index({ groupId: 1, _id: 1 });

export const SharedExpenseModel = mongoose.model<ISharedExpenseDocument>(
  MODEL_NAMES.SHARED_EXPENSE,
  SharedExpenseSchema,
);
