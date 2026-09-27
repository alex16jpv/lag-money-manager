import mongoose, { Schema } from "mongoose";

import { EmailDeliveryAttempt } from "../../domain/repositories/emailDelivery/IEmailDeliveryRepository";
import {
  EMAIL_DELIVERY_STATUSES,
  EMAIL_PROVIDER_NAMES,
  EmailDeliveryStatus,
  EmailProviderName,
} from "../../shared/constants";

export const EMAIL_DELIVERY_RETENTION_DAYS = 30;

export interface IEmailDeliveryDocument {
  template: string;
  budget: string;
  userId: string;
  toHash: string;
  status: EmailDeliveryStatus;
  provider: EmailProviderName | null;
  messageId: string | null;
  failures: EmailDeliveryAttempt[];
  reportedAt: Date | null;
  report: string | null;
  createdAt: Date;
}

const EmailDeliverySchema = new Schema<IEmailDeliveryDocument>(
  {
    template: { type: String, required: true },
    budget: { type: String, required: true },
    userId: { type: String, required: true },
    toHash: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(EMAIL_DELIVERY_STATUSES),
    },
    provider: {
      type: String,
      default: null,
      enum: [...Object.values(EMAIL_PROVIDER_NAMES), null],
    },
    messageId: { type: String, default: null },
    failures: {
      type: [
        {
          _id: false,
          provider: { type: String, required: true },
          error: { type: String, required: true },
          detail: { type: String },
        },
      ],
      default: [],
    },
    reportedAt: { type: Date, default: null },
    report: { type: String, default: null },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

EmailDeliverySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: EMAIL_DELIVERY_RETENTION_DAYS * 24 * 60 * 60 },
);

EmailDeliverySchema.index({ provider: 1, messageId: 1 });

export const EmailDeliveryModel = mongoose.model<IEmailDeliveryDocument>(
  "EmailDelivery",
  EmailDeliverySchema,
);
