import mongoose, { Schema } from "mongoose";
import {
  MODEL_NAMES,
  TRANSACTION_TYPES,
  TransactionType,
} from "../../../shared/constants";

export interface ITransactionDocument {
  _id: string;
  type: TransactionType;
  amount: number;
  date: Date;
  categoryId: string | null;
  description: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  userId: string;
  tags: string | null;
  note: string | null;
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
    tags: { type: String, default: null },
    note: { type: String, default: null },
  },
  { timestamps: true },
);

export const TransactionMongoModel = mongoose.model<ITransactionDocument>(
  MODEL_NAMES.TRANSACTION,
  TransactionSchema,
);
