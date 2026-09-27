import {
  EmailDeliveryStatus,
  EmailProviderName,
} from "../../../shared/constants";

export interface EmailDeliveryAttempt {
  provider: EmailProviderName;
  error: string;
  detail?: string;
}

export interface NewEmailDelivery {
  template: string;
  budget: string;
  userId: string;
  // SHA-256 of the normalized address: the address itself is never stored.
  toHash: string;
  status: EmailDeliveryStatus;
  provider: EmailProviderName | null;
  messageId: string | null;
  failures: EmailDeliveryAttempt[];
}

export interface EmailDeliveryReport {
  provider: EmailProviderName;
  messageId: string;
  status: EmailDeliveryStatus;
  // The row moves only from one of these, so a late or repeated event never rolls it back.
  from: EmailDeliveryStatus[];
  at: Date;
  detail: string | null;
}

export interface IEmailDeliveryRepository {
  record(delivery: NewEmailDelivery): Promise<void>;

  // A row already there, further along or gone with its TTL is left as it is.
  report(report: EmailDeliveryReport): Promise<void>;
}
