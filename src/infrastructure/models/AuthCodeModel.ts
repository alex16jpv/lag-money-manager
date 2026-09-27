import mongoose, { Schema } from "mongoose";

import { AUTH_CODE_PURPOSES, AuthCodePurpose } from "../../shared/constants";

export interface IAuthCodeDocument {
  _id: string;
  purpose: AuthCodePurpose;
  toHash: string;
  userId: string | null;
  codes: { codeHash: string; tokenHash: string; expiresAt: Date }[];
  attempts: number;
  expiresAt: Date;
}

const AuthCodeSchema = new Schema<IAuthCodeDocument>(
  {
    _id: { type: String, required: true },
    purpose: {
      type: String,
      required: true,
      enum: Object.values(AUTH_CODE_PURPOSES),
    },
    toHash: { type: String, required: true },
    userId: { type: String, default: null },
    codes: {
      type: [
        {
          _id: false,
          codeHash: { type: String, required: true },
          tokenHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
    attempts: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

AuthCodeSchema.index({ purpose: 1, toHash: 1 }, { unique: true });
AuthCodeSchema.index({ "codes.tokenHash": 1 });
AuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthCodeModel = mongoose.model<IAuthCodeDocument>(
  "AuthCode",
  AuthCodeSchema,
);
