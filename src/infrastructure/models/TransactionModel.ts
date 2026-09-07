import mongoose, { Schema } from "mongoose";

import {
  MODEL_NAMES,
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
  TransactionType,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";

export interface ITransactionDocument {
  _id: string;
  type: TransactionType;
  amount: number; // integer cents
  date: Date;
  categoryId: string | null;
  description: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  userId: string;
  tags: string[];
  note: string | null;
  pendingDetails: boolean;
  source?: string;
  currency: string;
  revisions?: {
    at: Date;
    amount: number;
    type: string;
    fromAccountId: string | null;
    toAccountId: string | null;
    date: Date;
  }[];
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
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    categoryId: { type: String, default: null },
    description: { type: String, default: null },
    fromAccountId: { type: String, default: null },
    toAccountId: { type: String, default: null },
    userId: { type: String, required: true },
    tags: { type: [String], default: [] },
    note: { type: String, default: null },
    pendingDetails: { type: Boolean, required: true, default: false },
    source: {
      type: String,
      required: true,
      enum: Object.keys(TRANSACTION_SOURCES),
      default: "MANUAL",
    },
    currency: {
      type: String,
      required: true,
      default: DEFAULT_CURRENCY,
      uppercase: true,
      trim: true,
    },
    // Audit trail of monetary edits (amount in cents); capped, internal-only.
    revisions: {
      type: [
        new Schema(
          {
            at: { type: Date, required: true },
            amount: { type: Number, required: true },
            type: { type: String, required: true },
            fromAccountId: { type: String, default: null },
            toAccountId: { type: String, default: null },
            date: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Primary listing sort; deletedAt included so the per-page count is
// resolved from the index instead of fetching every document.
TransactionSchema.index({ userId: 1, deletedAt: 1, date: -1, _id: -1 });
TransactionSchema.index({ userId: 1, categoryId: 1, date: -1 });
TransactionSchema.index({ userId: 1, tags: 1, date: -1 });
// Each $or branch of the accountId filter needs its own userId-prefixed index.
TransactionSchema.index({ userId: 1, fromAccountId: 1, date: -1 });
TransactionSchema.index({ userId: 1, toAccountId: 1, date: -1 });
// The filter sheet previews its result count with limit=1, so the count matters
// more than the page. Measured over 50k transactions: without this the count
// fetches every live document (45 ms); with it, it is answered from the index
// alone (1 ms). `type` gets no such index on purpose — it matches almost every
// document, so an index cannot save the visit.
TransactionSchema.index({ userId: 1, deletedAt: 1, source: 1, date: -1 });
// The review inbox is a hot screen and a tiny slice: a partial index over just
// the pending rows is ~2% of the primary index's size.
TransactionSchema.index(
  { userId: 1, date: -1 },
  { partialFilterExpression: { pendingDetails: true, deletedAt: null } },
);

// Offline change feed: keyset pagination over (updatedAt, _id), archived and
// deleted rows included — the client learns of a disappearance no other way.
TransactionSchema.index({ userId: 1, updatedAt: 1, _id: 1 });

export const TransactionModel = mongoose.model<ITransactionDocument>(
  MODEL_NAMES.TRANSACTION,
  TransactionSchema,
);
