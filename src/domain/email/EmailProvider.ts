import { EmailProviderName } from "../../shared/constants";
import { describeError } from "../../shared/errorDetail";

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

export type EmailSendOutcome = "refused" | "neverLeft" | "mayHaveSent";

export interface EmailProviderErrorOptions {
  outcome?: EmailSendOutcome;
  cause?: unknown;
  detail?: string;
}

export class EmailProviderError extends Error {
  readonly outcome: EmailSendOutcome;
  readonly cause?: unknown;
  readonly detail?: string;

  constructor(
    readonly provider: EmailProviderName,
    readonly kind: EmailFailureKind,
    readonly reason: string,
    options: EmailProviderErrorOptions = {},
  ) {
    super(`${provider}: ${reason}`);
    this.name = "EmailProviderError";
    this.outcome = options.outcome ?? "mayHaveSent";
    this.cause = options.cause;
    this.detail = options.detail ?? describeError(options.cause);
  }

  get nothingSent(): boolean {
    return this.outcome !== "mayHaveSent";
  }
}
