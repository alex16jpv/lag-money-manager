import mongoose, { Schema } from "mongoose";
import {
  ACCOUNT_TYPES,
  AccountType,
  COLORS,
  MODEL_NAMES,
} from "../../../shared/constants";

export interface IAccountDocument {
  _id: string;
  name: string;
  type: AccountType;
  balance: number;
  color?: string;
  userId: string;
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
    color: { type: String, required: false, enum: Object.keys(COLORS) },
    userId: { type: String, required: true },
  },
  { timestamps: true },
);

AccountSchema.index({ userId: 1, _id: 1 });

export const AccountMongoModel = mongoose.model<IAccountDocument>(
  MODEL_NAMES.ACCOUNT,
  AccountSchema,
);
