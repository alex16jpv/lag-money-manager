import { sign } from "crypto";

import { HttpGet } from "../../infrastructure/email/SnsInbox";
import { TEST_SNS_CERTIFICATE, TEST_SNS_PRIVATE_KEY } from "./snsTestKeys";

export const TOPIC_ARN =
  "arn:aws:sns:us-east-1:123456789012:ledger-flow-email-events";
export const CERT_URL =
  "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem";
export const SUBSCRIBE_URL =
  "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=t";
export const INSIDE_VALIDITY = new Date("2027-01-01T00:00:00Z");

const SIGNED = {
  Notification: [
    "Message",
    "MessageId",
    "Subject",
    "Timestamp",
    "TopicArn",
    "Type",
  ],
  SubscriptionConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
  UnsubscribeConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
} as const;

type SnsType = keyof typeof SIGNED;

export function signedSnsMessage(
  overrides: Record<string, string> & { Type?: SnsType } = {},
  version: "1" | "2" = "2",
): Record<string, string> {
  const type: SnsType = overrides.Type ?? "Notification";
  const message: Record<string, string> = {
    Type: type,
    MessageId: "8e3b2c1a-0000-4000-8000-000000000001",
    TopicArn: TOPIC_ARN,
    Message: "{}",
    Timestamp: "2027-01-01T00:00:00.000Z",
    SignatureVersion: version,
    SigningCertURL: CERT_URL,
    ...(type === "Notification"
      ? {}
      : { SubscribeURL: SUBSCRIBE_URL, Token: "token-1" }),
    ...overrides,
  };
  const text = (SIGNED[type] ?? SIGNED.Notification)
    .filter((field) => message[field] !== undefined)
    .map((field) => `${field}\n${message[field]}\n`)
    .join("");
  message.Signature = sign(
    version === "1" ? "sha1" : "sha256",
    Buffer.from(text, "utf8"),
    TEST_SNS_PRIVATE_KEY,
  ).toString("base64");
  return message;
}

export function fakeSnsHttp(): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const get = async (url: URL): Promise<{ status: number; body: string }> => {
    calls.push(url.href);
    return url.href === CERT_URL
      ? { status: 200, body: TEST_SNS_CERTIFICATE }
      : { status: 200, body: "<ConfirmSubscriptionResponse/>" };
  };
  return Object.assign(get, { calls });
}
