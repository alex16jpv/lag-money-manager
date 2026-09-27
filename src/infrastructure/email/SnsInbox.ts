import { KeyObject, verify, X509Certificate } from "crypto";
import { z } from "zod";

import {
  ISnsInbox,
  SnsMessage,
  SnsRejection,
  SnsUnavailable,
} from "../../domain/email/SnsInbox";
import { SNS_TOPIC_ARN } from "../../shared/constants";

const HTTP_TIMEOUT_MS = 3000;
// SNS gives up retrying within an hour; anything older is a replay.
const MAX_MESSAGE_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_CACHED_CERTIFICATES = 8;

const snsMessageSchema = z.object({
  Type: z.enum([
    "Notification",
    "SubscriptionConfirmation",
    "UnsubscribeConfirmation",
  ]),
  MessageId: z.string().min(1),
  TopicArn: z.string().min(1),
  Message: z.string(),
  Timestamp: z.string().min(1),
  SignatureVersion: z.enum(["1", "2"]),
  Signature: z.string().min(1),
  SigningCertURL: z.string().min(1),
  Subject: z.string().optional(),
  SubscribeURL: z.string().optional(),
  Token: z.string().optional(),
});

const CONFIRMATION_FIELDS = [
  "Message",
  "MessageId",
  "SubscribeURL",
  "Timestamp",
  "Token",
  "TopicArn",
  "Type",
] as const;

const SIGNED_FIELDS = {
  Notification: [
    "Message",
    "MessageId",
    "Subject",
    "Timestamp",
    "TopicArn",
    "Type",
  ],
  SubscriptionConfirmation: CONFIRMATION_FIELDS,
  UnsubscribeConfirmation: CONFIRMATION_FIELDS,
} as const;

export type HttpGet = (url: URL) => Promise<{ status: number; body: string }>;

const httpGet: HttpGet = async (url) => {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  return { status: response.status, body: await response.text() };
};

interface SigningCertificate {
  key: KeyObject;
  validFrom: number;
  validTo: number;
}

function stringToSign(message: SnsMessage): string {
  return SIGNED_FIELDS[message.Type]
    .filter((field) => message[field] !== undefined)
    .map((field) => `${field}\n${message[field]}\n`)
    .join("");
}

export class SnsInbox implements ISnsInbox {
  private readonly trustedHosts: Set<string>;
  private readonly certificates = new Map<
    string,
    Promise<SigningCertificate>
  >();

  constructor(
    private readonly topicArn: string | undefined,
    private readonly get: HttpGet = httpGet,
    private readonly now: () => Date = () => new Date(),
  ) {
    const region = topicArn?.match(SNS_TOPIC_ARN)?.[1];
    this.trustedHosts = new Set(
      region
        ? [`sns.${region}.amazonaws.com`, `sns.${region}.amazonaws.com.cn`]
        : [],
    );
  }

  async open(body: string): Promise<SnsMessage> {
    if (!this.topicArn) throw new SnsRejection("not-configured");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new SnsRejection("malformed");
    }
    const result = snsMessageSchema.safeParse(parsed);
    if (!result.success) throw new SnsRejection("malformed");
    const message = result.data;
    if (message.TopicArn !== this.topicArn) {
      throw new SnsRejection("unexpected-topic");
    }
    const sentAt = new Date(message.Timestamp).getTime();
    if (Number.isNaN(sentAt)) throw new SnsRejection("malformed");
    if (this.now().getTime() - sentAt > MAX_MESSAGE_AGE_MS) {
      throw new SnsRejection("stale");
    }
    if (message.Type !== "Notification") {
      if (!message.SubscribeURL || !message.Token) {
        throw new SnsRejection("malformed");
      }
      this.trusted(message.SubscribeURL);
    }

    const certUrl = this.trusted(message.SigningCertURL);
    if (
      !certUrl.pathname.endsWith(".pem") ||
      certUrl.search !== "" ||
      certUrl.hash !== ""
    ) {
      throw new SnsRejection("untrusted-url");
    }
    const key = await this.signingKey(certUrl);
    const valid = verify(
      message.SignatureVersion === "1" ? "sha1" : "sha256",
      Buffer.from(stringToSign(message), "utf8"),
      key,
      Buffer.from(message.Signature, "base64"),
    );
    if (!valid) throw new SnsRejection("bad-signature");
    return message;
  }

  async confirmSubscription(message: SnsMessage): Promise<void> {
    const url = this.trusted(message.SubscribeURL ?? "");
    let status: number;
    try {
      ({ status } = await this.get(url));
    } catch (err) {
      throw new SnsUnavailable("subscription", err);
    }
    if (status >= 500) {
      throw new SnsUnavailable("subscription", new Error(`HTTP ${status}`));
    }
    if (status !== 200) throw new SnsRejection("subscription-refused");
  }

  private trusted(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SnsRejection("untrusted-url");
    }
    if (
      url.protocol !== "https:" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      !this.trustedHosts.has(url.hostname)
    ) {
      throw new SnsRejection("untrusted-url");
    }
    return url;
  }

  private async signingKey(url: URL): Promise<KeyObject> {
    const cacheKey = url.origin + url.pathname;
    let loading = this.certificates.get(cacheKey);
    if (!loading) {
      if (this.certificates.size >= MAX_CACHED_CERTIFICATES) {
        const [oldest] = this.certificates.keys();
        this.certificates.delete(oldest);
      }
      loading = this.loadCertificate(url);
      this.certificates.set(cacheKey, loading);
      loading.catch(() => this.certificates.delete(cacheKey));
    }
    const certificate = await loading;
    const now = this.now().getTime();
    if (!(now >= certificate.validFrom && now <= certificate.validTo)) {
      throw new SnsRejection("bad-certificate");
    }
    return certificate.key;
  }

  private async loadCertificate(url: URL): Promise<SigningCertificate> {
    let response: { status: number; body: string };
    try {
      response = await this.get(url);
    } catch (err) {
      throw new SnsUnavailable("certificate", err);
    }
    if (response.status >= 500) {
      throw new SnsUnavailable(
        "certificate",
        new Error(`HTTP ${response.status}`),
      );
    }
    if (response.status !== 200) throw new SnsRejection("bad-certificate");
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(response.body);
    } catch {
      throw new SnsRejection("bad-certificate");
    }
    return {
      key: certificate.publicKey,
      validFrom: new Date(certificate.validFrom).getTime(),
      validTo: new Date(certificate.validTo).getTime(),
    };
  }
}
