import mongoose, { Schema } from "mongoose";

import { MODEL_NAMES } from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { DEFAULT_LOCALE, Locale, LOCALES } from "../../shared/locale";
import { Theme, THEME_MODES, THEME_PALETTES } from "../../shared/theme";
import { DEFAULT_TIMEZONE } from "../../shared/timezone";

export interface IEmailChangeDocument {
  email: string;
  sentAt: Date;
  expiresAt: Date;
}

export interface IUndoLinkDocument {
  email: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface IRestoreLinkDocument {
  tokenHash: string;
  expiresAt: Date;
}

export interface IConfirmDeadlineDocument {
  day: string;
  endsAt: Date;
  remindedAt: Date | null;
  links: { email: string; tokenHash: string }[];
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
  theme: Theme | null;
  lastLoginAt: Date | null;
  emailVerifiedAt: Date | null;
  confirmDeadline: IConfirmDeadlineDocument | null;
  emailChange: IEmailChangeDocument | null;
  undoLinks: IUndoLinkDocument[];
  heldEmails?: string[];
  devicesResetAt: Date | null;
  dataResetAt: Date | null;
  deletedAt: Date | null;
  keptUntil: Date | null;
  restoreLinks: IRestoreLinkDocument[];
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
    theme: {
      type: new Schema<Theme>(
        {
          palette: {
            type: String,
            required: true,
            enum: Object.keys(THEME_PALETTES),
          },
          mode: {
            type: String,
            required: true,
            enum: Object.keys(THEME_MODES),
          },
        },
        { _id: false },
      ),
      default: null,
    },
    lastLoginAt: { type: Date, default: null },
    emailVerifiedAt: { type: Date, default: null },
    confirmDeadline: {
      type: new Schema<IConfirmDeadlineDocument>(
        {
          day: { type: String, required: true },
          endsAt: { type: Date, required: true },
          remindedAt: { type: Date, default: null },
          links: {
            type: [
              new Schema(
                {
                  email: {
                    type: String,
                    required: true,
                    lowercase: true,
                    trim: true,
                  },
                  tokenHash: { type: String, required: true },
                },
                { _id: false },
              ),
            ],
            default: [],
          },
        },
        { _id: false },
      ),
      default: null,
    },
    emailChange: {
      type: new Schema<IEmailChangeDocument>(
        {
          email: { type: String, required: true, lowercase: true, trim: true },
          sentAt: { type: Date, required: true },
          expiresAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    undoLinks: {
      type: [
        new Schema<IUndoLinkDocument>(
          {
            email: {
              type: String,
              required: true,
              lowercase: true,
              trim: true,
            },
            tokenHash: { type: String, required: true },
            expiresAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    heldEmails: {
      type: [{ type: String, lowercase: true, trim: true }],
      default: undefined,
    },
    devicesResetAt: { type: Date, default: null },
    dataResetAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    keptUntil: { type: Date, default: null },
    restoreLinks: {
      type: [
        new Schema<IRestoreLinkDocument>(
          {
            tokenHash: { type: String, required: true },
            expiresAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    erasingAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// With the email's own index, no address is ever one account's email and another's reserved one.
UserSchema.index(
  { heldEmails: 1 },
  { unique: true, partialFilterExpression: { heldEmails: { $exists: true } } },
);

// The nightly pass: the accounts past their days, the ones claimed by an erasure, the ones still undated.
UserSchema.index({ keptUntil: 1 });
UserSchema.index({ erasingAt: 1 });
UserSchema.index({ deletedAt: 1 });
UserSchema.index({ emailVerifiedAt: 1, "confirmDeadline.endsAt": 1 });

export const UserModel = mongoose.model<IUserDocument>(
  MODEL_NAMES.USER,
  UserSchema,
);
