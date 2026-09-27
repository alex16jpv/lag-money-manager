import mongoose, { Schema } from "mongoose";

import { MODEL_NAMES } from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { DEFAULT_LOCALE, Locale, LOCALES } from "../../shared/locale";
import { DEFAULT_TIMEZONE } from "../../shared/timezone";

export interface IKeepOrStartFreshDocument {
  askedAt: Date;
  accounts: number;
  transactions: number;
  startFresh: {
    name: string;
    locale: Locale;
    currency: string;
    timezone: string;
    claimedUntil: Date;
  } | null;
}

export interface IUserDocument {
  _id: string;
  name: string;
  email: string;
  password: string;
  tokenVersion: number;
  timezone: string;
  currency: string;
  locale: Locale;
  lastLoginAt: Date | null;
  emailVerifiedAt: Date | null;
  firstVerifiedAt: Date | null;
  emailChangedAt: Date | null;
  keepOrStartFresh: IKeepOrStartFreshDocument | null;
  dataResetAt: Date | null;
  deletedAt: Date | null;
  erasingAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    tokenVersion: { type: Number, required: true, default: 0 },
    timezone: { type: String, required: true, default: DEFAULT_TIMEZONE },
    currency: {
      type: String,
      required: true,
      default: DEFAULT_CURRENCY,
      uppercase: true,
      trim: true,
    },
    locale: {
      type: String,
      required: true,
      default: DEFAULT_LOCALE,
      enum: Object.keys(LOCALES),
    },
    lastLoginAt: { type: Date, default: null },
    emailVerifiedAt: { type: Date, default: null },
    firstVerifiedAt: { type: Date, default: null },
    emailChangedAt: { type: Date, default: null },
    keepOrStartFresh: {
      type: new Schema<IKeepOrStartFreshDocument>(
        {
          askedAt: { type: Date, required: true },
          accounts: { type: Number, required: true },
          transactions: { type: Number, required: true },
          startFresh: {
            type: new Schema(
              {
                name: { type: String, required: true },
                locale: {
                  type: String,
                  required: true,
                  enum: Object.keys(LOCALES),
                },
                currency: { type: String, required: true },
                timezone: { type: String, required: true },
                claimedUntil: { type: Date, required: true },
              },
              { _id: false },
            ),
            default: null,
          },
        },
        { _id: false },
      ),
      default: null,
    },
    dataResetAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    erasingAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const UserModel = mongoose.model<IUserDocument>(
  MODEL_NAMES.USER,
  UserSchema,
);
