import { EmailProviderName } from "../../shared/constants";

export interface OutgoingEmail {
  to: string;
  from: { name: string; address: string };
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  budget: string;
}

export interface EmailProvider {
  readonly name: EmailProviderName;
  send(
    email: OutgoingEmail,
    signal: AbortSignal,
  ): Promise<{ messageId: string }>;
}

export type EmailFailureKind = "recipient" | "transport";

export class EmailProviderError extends Error {
  constructor(
    readonly provider: EmailProviderName,
    readonly kind: EmailFailureKind,
    readonly reason: string,
    // True only when the provider answered with a refusal: anything else may have been sent and billed.
    readonly refused = false,
    readonly cause?: unknown,
  ) {
    super(`${provider}: ${reason}`);
    this.name = "EmailProviderError";
  }
}
