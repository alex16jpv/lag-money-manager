import mongoose, { Schema } from "mongoose";

import { MODEL_NAMES } from "../../shared/constants";
import { DEFAULT_TIMEZONE } from "../../shared/timezone";

export interface IUserDocument {
  _id: string;
  name: string;
  email: string;
  password: string;
  tokenVersion: number;
  timezone: string;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    tokenVersion: { type: Number, required: true, default: 0 },
    timezone: { type: String, required: true, default: DEFAULT_TIMEZONE },
    lastLoginAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const UserModel = mongoose.model<IUserDocument>(
  MODEL_NAMES.USER,
  UserSchema,
);
