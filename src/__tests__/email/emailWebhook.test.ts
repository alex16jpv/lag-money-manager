jest.mock("../../config/mongoConnection", () => ({
  connectMongo: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../shared/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

import express from "express";
import request from "supertest";

import { EmailWebhookController } from "../../app/controllers/EmailWebhookController";
import { requestLogMiddleware } from "../../app/middlewares/requestLogMiddleware";
import { emailWebhookRouter } from "../../app/routes/emailWebhookRoutes";
import { EmailEventService } from "../../app/services/EmailEventService";
import { connectMongo } from "../../config/mongoConnection";
import { HttpGet, SnsInbox } from "../../infrastructure/email/SnsInbox";
import logger from "../../shared/logger";
import { errorMiddleware } from "../../shared/middlewares";
import {
  CERT_URL,
  fakeSnsHttp,
  INSIDE_VALIDITY,
  signedSnsMessage,
  SUBSCRIBE_URL,
  TOPIC_ARN,
} from "./snsSigning";

const PERMANENT_BOUNCE = JSON.stringify({
  eventType: "Bounce",
  mail: {
    timestamp: "2027-01-01T10:00:00.000Z",
    messageId: "0100018f-ses-message",
    destination: ["ana@example.com"],
  },
  bounce: {
    bounceType: "Permanent",
    bounceSubType: "NoEmail",
    bouncedRecipients: [{ emailAddress: "ana@example.com" }],
    timestamp: "2027-01-01T10:00:05.000Z",
  },
});

describe("POST /webhooks/email/ses", () => {
  let get: HttpGet & { calls: string[] };
  let apply: jest.Mock;

  const app = (http: HttpGet = get): express.Express => {
    const events = { apply } as unknown as EmailEventService;
    const controller = new EmailWebhookController(
      new SnsInbox(TOPIC_ARN, http, () => INSIDE_VALIDITY),
      events,
    );
    const server = express();
    server.use(requestLogMiddleware);
    server.use("/webhooks/email", emailWebhookRouter(controller));
    server.use(errorMiddleware);
    return server;
  };

  const post = (
    server: express.Express,
    message: Record<string, string> | string,
  ): request.Test =>
    request(server)
      .post("/webhooks/email/ses")
      .set("content-type", "text/plain; charset=UTF-8")
      .send(typeof message === "string" ? message : JSON.stringify(message));

  beforeEach(() => {
    get = fakeSnsHttp();
    apply = jest.fn().mockResolvedValue(undefined);
  });

  it("applies a signed bounce sent as text/plain", async () => {
    const res = await post(
      app(),
      signedSnsMessage({ Message: PERMANENT_BOUNCE }),
    );
    expect(res.status).toBe(204);
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "bounced",
        suppress: true,
        messageId: "0100018f-ses-message",
      }),
    );
  });

  it("confirms the subscription", async () => {
    const res = await post(
      app(),
      signedSnsMessage({ Type: "SubscriptionConfirmation" }),
    );
    expect(res.status).toBe(204);
    expect(get.calls).toEqual([CERT_URL, SUBSCRIBE_URL]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EMAIL_EVENTS_SUBSCRIBED" }),
      expect.any(String),
    );
  });

  it("says loudly when it is unsubscribed", async () => {
    const res = await post(
      app(),
      signedSnsMessage({ Type: "UnsubscribeConfirmation" }),
    );
    expect(res.status).toBe(204);
    expect(get.calls).toEqual([CERT_URL]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EMAIL_EVENTS_UNSUBSCRIBED" }),
      expect.any(String),
    );
  });

  it("refuses a forged message with 403, which SNS does not retry, on one log line", async () => {
    const forged = signedSnsMessage({ Message: PERMANENT_BOUNCE });
    forged.Signature = Buffer.from("forged").toString("base64");
    const res = await post(app(), forged);
    expect(res.status).toBe(403);
    expect(apply).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 403,
        code: "EMAIL_EVENT_REJECTED",
        errorMessage: "bad-signature",
      }),
      "request rejected",
    );
  });

  it("verifies before it touches the database", async () => {
    await post(app(), "not signed").expect(403);
    expect(connectMongo).not.toHaveBeenCalled();
    await post(app(), signedSnsMessage({ Message: PERMANENT_BOUNCE })).expect(
      204,
    );
    expect(connectMongo).toHaveBeenCalled();
  });

  it("refuses with 403 a confirmation whose subscribe URL is off SNS", async () => {
    const res = await post(
      app(),
      signedSnsMessage({
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://evil.example/confirm",
      }),
    );
    expect(res.status).toBe(403);
    expect(get.calls).toEqual([]);
  });

  it("refuses with 403 a confirmation SNS no longer takes", async () => {
    const http: HttpGet = async (url) =>
      url.href === SUBSCRIBE_URL ? { status: 404, body: "" } : get(url);
    const res = await post(
      app(http),
      signedSnsMessage({ Type: "SubscriptionConfirmation" }),
    );
    expect(res.status).toBe(403);
  });

  it("acknowledges an event it does not act on", async () => {
    const res = await post(
      app(),
      signedSnsMessage({
        Message: JSON.stringify({
          eventType: "Open",
          mail: {
            messageId: "m",
            timestamp: "2027-01-01T00:00:00Z",
            destination: [],
          },
        }),
      }),
    );
    expect(res.status).toBe(204);
    expect(apply).not.toHaveBeenCalled();
  });

  it("drops a signed event it cannot read, since a retry would read the same", async () => {
    const res = await post(app(), signedSnsMessage({ Message: "not json" }));
    expect(res.status).toBe(204);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EMAIL_EVENT_UNREADABLE" }),
      expect.any(String),
    );
  });

  it("answers 503 when the certificate cannot be fetched, so SNS retries", async () => {
    const down: HttpGet = async () => {
      throw new Error("ETIMEDOUT");
    };
    const res = await post(app(down), signedSnsMessage());
    expect(res.status).toBe(503);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "EMAIL_EVENTS_CERTIFICATE_UNAVAILABLE",
        errorMessage: "SNS certificate did not answer: ETIMEDOUT",
      }),
      "request failed",
    );
  });

  it("answers 503 when the subscription cannot be confirmed", async () => {
    const http: HttpGet = async (url) =>
      url.href === SUBSCRIBE_URL ? { status: 500, body: "" } : get(url);
    const res = await post(
      app(http),
      signedSnsMessage({ Type: "SubscriptionConfirmation" }),
    );
    expect(res.status).toBe(503);
  });

  it("answers 500 when the store fails, so SNS retries", async () => {
    apply.mockRejectedValue(new Error("write failed"));
    const res = await post(
      app(),
      signedSnsMessage({ Message: PERMANENT_BOUNCE }),
    );
    expect(res.status).toBe(500);
  });

  it("refuses a body over its limit", async () => {
    const res = await post(app(), "x".repeat(129 * 1024));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("limits how often one address may call", async () => {
    const server = app();
    for (let i = 0; i < 120; i += 1) {
      await post(server, "{}").expect(403);
    }
    const res = await post(server, "{}");
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
  });
});
