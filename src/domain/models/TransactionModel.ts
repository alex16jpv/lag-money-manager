import mongoose, { Schema } from "mongoose";

import {
  MODEL_NAMES,
  TRANSACTION_TYPES,
  TransactionType,
} from "../../shared/constants";

export interface ITransactionDocument {
  _id: string;
  type: TransactionType;
  amount: number; // stored as integer cents
  date: Date;
  categoryId: string | null;
  description: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  userId: string;
  tags: string | null;
  note: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransactionDocument>(
  {
    _id: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: Object.keys(TRANSACTION_TYPES),
    },
    amount: { type: Number, required: true }, // integer cents
    date: { type: Date, required: true },
    categoryId: { type: String, default: null },
    description: { type: String, default: null },
    fromAccountId: { type: String, default: null },
    toAccountId: { type: String, default: null },
    userId: { type: String, required: true },
    tags: { type: String, default: null },
    note: { type: String, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Covers the primary listing query: filter by userId, sorted by (date DESC,
// _id DESC). Without this the sort runs in memory (32MB cap on Atlas M0).
TransactionSchema.index({ userId: 1, date: -1, _id: -1 });
// Supports per-category aggregation (spending stats) and the category filter.
TransactionSchema.index({ userId: 1, categoryId: 1, date: -1 });

export const TransactionModel = mongoose.model<ITransactionDocument>(
  MODEL_NAMES.TRANSACTION,
  TransactionSchema,
);
