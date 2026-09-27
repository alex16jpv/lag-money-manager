export interface SnsMessage {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

export type SnsRejectionReason =
  | "not-configured"
  | "malformed"
  | "stale"
  | "unexpected-topic"
  | "untrusted-url"
  | "bad-certificate"
  | "bad-signature"
  | "subscription-refused";

export class SnsRejection extends Error {
  constructor(readonly reason: SnsRejectionReason) {
    super(`SNS message rejected: ${reason}`);
    this.name = "SnsRejection";
  }
}

export class SnsUnavailable extends Error {
  constructor(
    readonly step: "certificate" | "subscription",
    readonly cause: unknown,
  ) {
    super(`SNS ${step} did not answer`);
    this.name = "SnsUnavailable";
  }
}

export interface ISnsInbox {
  // Resolves only for a message signed by SNS for our topic; throws SnsRejection or SnsUnavailable.
  open(body: string): Promise<SnsMessage>;

  confirmSubscription(message: SnsMessage): Promise<void>;
}
