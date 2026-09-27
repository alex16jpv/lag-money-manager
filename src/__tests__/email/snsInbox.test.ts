import { SnsRejection, SnsUnavailable } from "../../domain/email/SnsInbox";
import { HttpGet, SnsInbox } from "../../infrastructure/email/SnsInbox";
import {
  CERT_URL,
  fakeSnsHttp,
  INSIDE_VALIDITY,
  signedSnsMessage,
  SUBSCRIBE_URL,
  TOPIC_ARN,
} from "./snsSigning";

const inbox = (
  get: HttpGet = fakeSnsHttp(),
  topicArn: string = TOPIC_ARN,
  now: Date = INSIDE_VALIDITY,
): SnsInbox => new SnsInbox(topicArn, get, () => now);

const rejection = async (
  promise: Promise<unknown>,
): Promise<string | undefined> => {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SnsRejection) return err.reason;
    throw err;
  }
  return undefined;
};

const body = (message: Record<string, string>): string =>
  JSON.stringify(message);

describe("SnsInbox", () => {
  describe("a genuine message of our topic", () => {
    it.each(["1", "2"] as const)(
      "opens a notification signed with version %s",
      async (version) => {
        const message = signedSnsMessage({ Message: '{"a":1}' }, version);
        await expect(inbox().open(body(message))).resolves.toMatchObject({
          Type: "Notification",
          Message: '{"a":1}',
        });
      },
    );

    it("signs the subject when there is one", async () => {
      const message = signedSnsMessage({ Subject: "Amazon SES Email Event" });
      await expect(inbox().open(body(message))).resolves.toMatchObject({
        Subject: "Amazon SES Email Event",
      });
    });

    it("opens a subscription confirmation, whose token and URL are signed", async () => {
      const message = signedSnsMessage({ Type: "SubscriptionConfirmation" });
      await expect(inbox().open(body(message))).resolves.toMatchObject({
        Type: "SubscriptionConfirmation",
        SubscribeURL: SUBSCRIBE_URL,
      });
    });

    it("fetches a certificate once for many messages", async () => {
      const get = fakeSnsHttp();
      const box = inbox(get);
      await box.open(body(signedSnsMessage()));
      await box.open(body(signedSnsMessage({ MessageId: "second" })));
      expect(get.calls).toEqual([CERT_URL]);
    });
  });

  describe("refuses", () => {
    it("everything while no topic is configured", async () => {
      const box = new SnsInbox(undefined, fakeSnsHttp(), () => INSIDE_VALIDITY);
      expect(await rejection(box.open(body(signedSnsMessage())))).toBe(
        "not-configured",
      );
    });

    it.each([
      ["not JSON", "hello"],
      ["JSON that is not an SNS message", '{"Type":"Notification"}'],
      ["an unknown type", body(signedSnsMessage({ Type: "Other" as never }))],
    ])("%s", async (_name, raw) => {
      expect(await rejection(inbox().open(raw))).toBe("malformed");
    });

    it("a confirmation without its subscribe URL", async () => {
      const message = signedSnsMessage({ Type: "SubscriptionConfirmation" });
      delete message.SubscribeURL;
      expect(await rejection(inbox().open(body(message)))).toBe("malformed");
    });

    it("a message of another topic, before fetching anything", async () => {
      const get = fakeSnsHttp();
      const message = signedSnsMessage({
        TopicArn: "arn:aws:sns:us-east-1:999999999999:someone-else",
      });
      expect(await rejection(inbox(get).open(body(message)))).toBe(
        "unexpected-topic",
      );
      expect(get.calls).toEqual([]);
    });

    it.each([
      ["over http", "http://sns.us-east-1.amazonaws.com/cert.pem"],
      ["on another host", "https://evil.example/cert.pem"],
      [
        "on a look-alike host",
        "https://sns.us-east-1.amazonaws.com.evil.example/cert.pem",
      ],
      ["in another region", "https://sns.eu-west-1.amazonaws.com/cert.pem"],
      ["with a port", "https://sns.us-east-1.amazonaws.com:8443/cert.pem"],
      ["with credentials", "https://a:b@sns.us-east-1.amazonaws.com/cert.pem"],
      [
        "with only a password",
        "https://:b@sns.us-east-1.amazonaws.com/cert.pem",
      ],
      ["with a query", "https://sns.us-east-1.amazonaws.com/cert.pem?r=1"],
      ["with a fragment", "https://sns.us-east-1.amazonaws.com/cert.pem#r"],
      [
        "that is not a certificate",
        "https://sns.us-east-1.amazonaws.com/cert.txt",
      ],
      ["that is not a URL", "not a url"],
    ])("a certificate %s, without fetching it", async (_name, url) => {
      const get = fakeSnsHttp();
      const message = signedSnsMessage({ SigningCertURL: url });
      expect(await rejection(inbox(get).open(body(message)))).toBe(
        "untrusted-url",
      );
      expect(get.calls).toEqual([]);
    });

    it("a message changed after it was signed", async () => {
      const message = signedSnsMessage({ Message: '{"bounce":"Transient"}' });
      message.Message = '{"bounce":"Permanent"}';
      expect(await rejection(inbox().open(body(message)))).toBe(
        "bad-signature",
      );
    });

    it("a signature made for another version", async () => {
      const message = signedSnsMessage({}, "1");
      message.SignatureVersion = "2";
      expect(await rejection(inbox().open(body(message)))).toBe(
        "bad-signature",
      );
    });

    it.each([
      ["missing", { status: 404, body: "Not Found" }],
      ["not a certificate", { status: 200, body: "garbage" }],
    ])("a certificate that is %s", async (_name, response) => {
      const get: HttpGet = async () => response;
      expect(await rejection(inbox(get).open(body(signedSnsMessage())))).toBe(
        "bad-certificate",
      );
    });

    it("a certificate outside its validity", async () => {
      const later = new Date("2127-01-01T00:00:00Z");
      const box = inbox(fakeSnsHttp(), TOPIC_ARN, later);
      const message = signedSnsMessage({ Timestamp: later.toISOString() });
      expect(await rejection(box.open(body(message)))).toBe("bad-certificate");
    });

    it("a message older than SNS keeps retrying, before fetching anything", async () => {
      const get = fakeSnsHttp();
      const message = signedSnsMessage({
        Timestamp: "2026-12-31T21:59:59.000Z",
      });
      expect(await rejection(inbox(get).open(body(message)))).toBe("stale");
      expect(get.calls).toEqual([]);
    });

    it("a message whose time is unreadable", async () => {
      const message = signedSnsMessage({ Timestamp: "yesterday" });
      expect(await rejection(inbox().open(body(message)))).toBe("malformed");
    });

    it("a confirmation whose subscribe URL is off SNS, before fetching anything", async () => {
      const get = fakeSnsHttp();
      const message = signedSnsMessage({
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://evil.example/confirm",
      });
      expect(await rejection(inbox(get).open(body(message)))).toBe(
        "untrusted-url",
      );
      expect(get.calls).toEqual([]);
    });
  });

  describe("when SNS does not answer", () => {
    it("says so instead of refusing, and tries the certificate again next time", async () => {
      const real = fakeSnsHttp();
      let down = true;
      const get: HttpGet = async (url) => {
        if (down) throw new Error("ECONNRESET");
        return real(url);
      };
      const box = inbox(get);
      await expect(box.open(body(signedSnsMessage()))).rejects.toBeInstanceOf(
        SnsUnavailable,
      );
      down = false;
      await expect(box.open(body(signedSnsMessage()))).resolves.toBeDefined();
    });

    it("treats a 5xx for the certificate as unavailable", async () => {
      const get: HttpGet = async () => ({ status: 503, body: "" });
      await expect(
        inbox(get).open(body(signedSnsMessage())),
      ).rejects.toBeInstanceOf(SnsUnavailable);
    });
  });

  describe("confirming a subscription", () => {
    it("visits the subscribe URL", async () => {
      const get = fakeSnsHttp();
      const box = inbox(get);
      const message = await box.open(
        body(signedSnsMessage({ Type: "SubscriptionConfirmation" })),
      );
      await box.confirmSubscription(message);
      expect(get.calls).toEqual([CERT_URL, SUBSCRIBE_URL]);
    });

    it("is refused when SNS refuses the token", async () => {
      const real = fakeSnsHttp();
      const get: HttpGet = async (url) =>
        url.href === SUBSCRIBE_URL ? { status: 403, body: "" } : real(url);
      const box = inbox(get);
      const message = await box.open(
        body(signedSnsMessage({ Type: "SubscriptionConfirmation" })),
      );
      expect(await rejection(box.confirmSubscription(message))).toBe(
        "subscription-refused",
      );
    });

    it("is unavailable when SNS does not answer", async () => {
      const real = fakeSnsHttp();
      const get: HttpGet = async (url) =>
        url.href === SUBSCRIBE_URL ? { status: 500, body: "" } : real(url);
      const box = inbox(get);
      const message = await box.open(
        body(signedSnsMessage({ Type: "SubscriptionConfirmation" })),
      );
      await expect(box.confirmSubscription(message)).rejects.toBeInstanceOf(
        SnsUnavailable,
      );
    });
  });
});
