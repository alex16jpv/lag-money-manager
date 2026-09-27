import {
  EmailDeliveryStatus,
  EmailProviderName,
} from "../../../shared/constants";

export interface EmailDeliveryAttempt {
  provider: EmailProviderName;
  error: string;
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

export interface IEmailDeliveryRepository {
  record(delivery: NewEmailDelivery): Promise<void>;
}
