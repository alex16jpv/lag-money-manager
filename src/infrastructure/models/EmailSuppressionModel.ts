import mongoose, { Schema } from "mongoose";

import {
  EMAIL_PROVIDER_NAMES,
  EMAIL_SUPPRESSION_REASONS,
  EmailProviderName,
  EmailSuppressionReason,
} from "../../shared/constants";

export interface IEmailSuppressionDocument {
  toHash: string;
  reason: EmailSuppressionReason;
  provider: EmailProviderName;
  detail: string | null;
  suppressedAt: Date;
  liftedAt: Date | null;
}

const EmailSuppressionSchema = new Schema<IEmailSuppressionDocument>(
  {
    toHash: { type: String, required: true },
    reason: {
      type: String,
      required: true,
      enum: Object.values(EMAIL_SUPPRESSION_REASONS),
    },
    provider: {
      type: String,
      required: true,
      enum: Object.values(EMAIL_PROVIDER_NAMES),
    },
    detail: { type: String, default: null },
    suppressedAt: { type: Date, required: true },
    liftedAt: { type: Date, default: null },
  },
  { versionKey: false },
);

EmailSuppressionSchema.index({ toHash: 1 }, { unique: true });

export const EmailSuppressionModel = mongoose.model<IEmailSuppressionDocument>(
  "EmailSuppression",
  EmailSuppressionSchema,
);
