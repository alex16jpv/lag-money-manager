import { EmailOutcome, EmailService } from "../../app/services/EmailService";
import { EmailProvider } from "../../domain/email/EmailProvider";
import {
  EMAIL_DELIVERY_RETENTION_DAYS,
  EmailDeliveryModel,
} from "../../infrastructure/models/EmailDeliveryModel";
import { RateLimitModel } from "../../infrastructure/models/RateLimitModel";
import { EmailDeliveryRepository } from "../../infrastructure/repositories/emailDelivery/EmailDeliveryRepository";
import { EmailSuppressionRepository } from "../../infrastructure/repositories/emailSuppression/EmailSuppressionRepository";
import { RateCounterRepository } from "../../infrastructure/repositories/rateCounter/RateCounterRepository";
import { hashEmailAddress } from "../../shared/emailHash";
import { connect, disconnect, dropDatabase } from "./support";

const provider: EmailProvider = {
  name: "mailpit",
  send: async () => ({ messageId: "mailpit-1" }),
};

const service = (): EmailService =>
  new EmailService(
    [provider],
    new RateCounterRepository(),
    new EmailDeliveryRepository(),
    new EmailSuppressionRepository(),
    {
      enabled: true,
      from: {
        name: "Ledger Flow",
        address: "no-reply@ledgerflow.alexpiral.com",
      },
      replyTo: "ledgerflow@alexpiral.com",
      appUrl: "https://ledgerflow.alexpiral.com",
      providerTimeoutMs: 1500,
      caps: { daily: 300, monthly: 9000, resetPercent: 30, otherPercent: 20 },
      brakes: {
        addressIntervalSeconds: 60,
        addressDailyMax: 5,
        userDailyMax: 5,
        deviceHourlyMax: 10,
        ipHourlyMax: 10,
      },
    },
  );

const sendReset = (svc: EmailService): Promise<EmailOutcome> =>
  svc.sendCode({
    template: "password-reset",
    data: { code: "482913", token: "q7Xk2mVb9RtL4wPz" },
    recipient: {
      userId: "user-1",
      email: "owner@email.test",
      locale: "en",
      timezone: "America/Bogota",
    },
    requester: { ip: "198.51.100.1", recognizedDevice: null },
  });

describe("email deliveries against MongoDB", () => {
  beforeAll(async () => {
    await connect();
    await dropDatabase();
    await EmailDeliveryModel.syncIndexes();
  });

  afterAll(async () => {
    await dropDatabase();
    await disconnect();
  });

  it("expires each delivery 30 days after it was written", async () => {
    const indexes = await EmailDeliveryModel.collection.indexes();
    const ttl = indexes.find((index) => index.key.createdAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(
      EMAIL_DELIVERY_RETENTION_DAYS * 24 * 60 * 60,
    );
  });

  it("records a send by the address's hash and counts it in the store", async () => {
    const svc = service();
    await expect(sendReset(svc)).resolves.toMatchObject({ status: "sent" });
    await expect(sendReset(svc)).resolves.toMatchObject({
      status: "limited",
      retryAfterSeconds: 60,
    });

    const rows = await EmailDeliveryModel.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      template: "password-reset",
      budget: "reset",
      status: "sent",
      provider: "mailpit",
      messageId: "mailpit-1",
      toHash: hashEmailAddress("owner@email.test"),
    });
    expect(JSON.stringify(rows)).not.toContain("owner@email.test");

    const day = new Date().toISOString().slice(0, 10);
    const cap = await RateLimitModel.findById(`email-cap:reset:${day}`).lean();
    expect(cap?.count).toBe(1);
    const address = await RateLimitModel.findById(
      `email-address:reset:${hashEmailAddress("owner@email.test")}`,
    ).lean();
    expect(address?.count).toBe(2);
  });
});
