import mongoose, { Schema } from "mongoose";

import { Locale, LOCALES } from "../../shared/locale";

export interface ISignUpDocument {
  _id: string;
  toHash: string;
  email: string;
  name: string;
  passwordHash: string;
  timezone?: string;
  currency?: string;
  locale?: Locale;
  userId: string | null;
  signedInAt: Date | null;
  expiresAt: Date;
}

const SignUpSchema = new Schema<ISignUpDocument>(
  {
    _id: { type: String, required: true },
    toHash: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    timezone: { type: String },
    currency: { type: String },
    locale: { type: String, enum: Object.keys(LOCALES) },
    userId: { type: String, default: null },
    signedInAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

SignUpSchema.index({ toHash: 1 }, { unique: true });
SignUpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SignUpModel = mongoose.model<ISignUpDocument>(
  "SignUp",
  SignUpSchema,
);
