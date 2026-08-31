import mongoose, { Schema } from "mongoose";
import { MODEL_NAMES } from "../../../shared/constants";

export interface IUserDocument {
  _id: string;
  name: string;
  email: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
  },
  { timestamps: true },
);

export const UserMongoModel = mongoose.model<IUserDocument>(
  MODEL_NAMES.USER,
  UserSchema,
);
