import mongoose, { Schema } from "mongoose";
import {
  ACCOUNT_TYPES,
  AccountType,
  MODEL_NAMES,
} from "../../../shared/constants";

export interface IAccountDocument {
  _id: string;
  name: string;
  type: AccountType;
  balance: number;
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
    userId: { type: String, required: true },
  },
  { timestamps: true },
);

export const AccountMongoModel = mongoose.model<IAccountDocument>(
  MODEL_NAMES.ACCOUNT,
  AccountSchema,
);
