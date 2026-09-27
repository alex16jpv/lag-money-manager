process.env.API_SECRET = "gateway-secret";
process.env.EMAIL_SES_EVENTS_TOPIC_ARN =
  "arn:aws:sns:us-east-1:123456789012:ledger-flow-email-events";

jest.mock("../../config/mongoConnection", () => ({
  connectMongo: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../shared/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

import request from "supertest";

import app from "../../app";
import logger from "../../shared/logger";

// The real app: the webhook has to be reachable without the gateway secret, and read before any JSON parser.
describe("the email webhook in the app", () => {
  it("is reached without the gateway secret, with its body untouched", async () => {
    const res = await request(app)
      .post("/webhooks/email/ses")
      .set("content-type", "application/json")
      .send('{"Type":"Notification"}');
    expect(res.status).toBe(403);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "EMAIL_EVENT_REJECTED",
        errorMessage: "malformed",
      }),
      expect.any(String),
    );
  });

  it("leaves every other path behind the gateway secret", async () => {
    const res = await request(app).get("/webhooks/email/ses");
    expect(res.status).toBe(403);
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "EMAIL_EVENT_REJECTED" }),
      expect.any(String),
    );
  });
});
