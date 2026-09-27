import {
  EmailProviderName,
  EmailSuppressionReason,
} from "../../../shared/constants";

export interface NewEmailSuppression {
  // SHA-256 of the normalized address: the address itself is never stored.
  toHash: string;
  reason: EmailSuppressionReason;
  provider: EmailProviderName;
  detail: string | null;
  at: Date;
}

export interface IEmailSuppressionRepository {
  isSuppressed(toHash: string): Promise<boolean>;

  // Idempotent; resolves true only when the address was not suppressed before.
  suppress(suppression: NewEmailSuppression): Promise<boolean>;

  lift(toHash: string): Promise<boolean>;
}
