import mongoose, { Schema } from "mongoose";

import {
  MODEL_NAMES,
  SETTLEMENT_PARTIES,
  SettlementPartyKind,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";

export interface ISharedSettlementDocument {
  _id: string;
  userId: string;
  counterparty: {
    kind: SettlementPartyKind;
    contactId: string | null;
    expenseId: string | null;
  };
  date: Date;
  collected: number; // integer cents
  paid: number; // integer cents
  outsideApp: boolean;
  currency: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SharedSettlementSchema = new Schema<ISharedSettlementDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    counterparty: {
      kind: {
        type: String,
        required: true,
        enum: Object.keys(SETTLEMENT_PARTIES),
      },
      contactId: { type: String, default: null },
      expenseId: { type: String, default: null },
    },
    date: { type: Date, required: true },
    collected: { type: Number, required: true, default: 0 },
    paid: { type: Number, required: true, default: 0 },
    outsideApp: { type: Boolean, required: true, default: false },
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

// Everything a person has paid you or you have paid them, which is what an imputation reads.
SharedSettlementSchema.index({
  userId: 1,
  "counterparty.contactId": 1,
  deletedAt: 1,
});
// The same for a block of guests, which lives in one expense and nets against nothing else.
SharedSettlementSchema.index({
  userId: 1,
  "counterparty.expenseId": 1,
  deletedAt: 1,
});
// The listing, newest first, and its keyset.
SharedSettlementSchema.index({ userId: 1, deletedAt: 1, date: 1, _id: 1 });
// Change feed: keyset over (updatedAt, _id), deleted rows included.
SharedSettlementSchema.index({ userId: 1, updatedAt: 1, _id: 1 });

export const SharedSettlementModel = mongoose.model<ISharedSettlementDocument>(
  MODEL_NAMES.SHARED_SETTLEMENT,
  SharedSettlementSchema,
);
