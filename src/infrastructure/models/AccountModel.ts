import mongoose, { Schema } from "mongoose";

import { NAME_COLLATION } from "../../shared/collation";
import {
  ACCOUNT_TYPES,
  AccountType,
  COLORS,
  MODEL_NAMES,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";

export interface IAccountDocument {
  _id: string;
  name: string;
  type: AccountType;
  balance: number; // integer cents
  openingBalance: number; // integer cents
  color?: string;
  userId: string;
  isDefault: boolean;
  currency: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<IAccountDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: Object.keys(ACCOUNT_TYPES),
    },
    balance: { type: Number, required: true },
    openingBalance: { type: Number, required: true, default: 0 },
    color: { type: String, required: false, enum: Object.keys(COLORS) },
    userId: { type: String, required: true },
    isDefault: { type: Boolean, required: true, default: false },
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

AccountSchema.index({ userId: 1, _id: 1 });
// One active name per user; collation strength 2 folds case, accents stay distinct.
AccountSchema.index(
  { userId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { archivedAt: null },
    collation: NAME_COLLATION,
  },
);
// At most one active default account per user.
AccountSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true, archivedAt: null },
  },
);

// Change feed: keyset over (updatedAt, _id), archived and deleted rows included.
AccountSchema.index({ userId: 1, updatedAt: 1, _id: 1 });

export const AccountModel = mongoose.model<IAccountDocument>(
  MODEL_NAMES.ACCOUNT,
  AccountSchema,
);
