import { EmailEventService } from "../../app/services/EmailEventService";
import { EmailOutcome, EmailService } from "../../app/services/EmailService";
import { EmailProvider } from "../../domain/email/EmailProvider";
import { NewEmailSuppression } from "../../domain/repositories/emailSuppression/IEmailSuppressionRepository";
import { EmailDeliveryModel } from "../../infrastructure/models/EmailDeliveryModel";
import { EmailSuppressionModel } from "../../infrastructure/models/EmailSuppressionModel";
import { EmailDeliveryRepository } from "../../infrastructure/repositories/emailDelivery/EmailDeliveryRepository";
import { EmailSuppressionRepository } from "../../infrastructure/repositories/emailSuppression/EmailSuppressionRepository";
import { RateCounterRepository } from "../../infrastructure/repositories/rateCounter/RateCounterRepository";
import { hashEmailAddress } from "../../shared/emailHash";
import { connect, disconnect, dropDatabase } from "./support";

const suppressions = new EmailSuppressionRepository();
const deliveries = new EmailDeliveryRepository();
const HASH = hashEmailAddress("gone@email.test");
const AT = new Date("2027-01-01T10:00:05Z");

const bounceOf = (toHash: string, at = AT): NewEmailSuppression => ({
  toHash,
  reason: "bounce",
  provider: "ses",
  detail: "Permanent/NoEmail",
  at,
});

const sentRow = async (messageId: string): Promise<void> => {
  await deliveries.record({
    template: "verify-email",
    budget: "security",
    userId: "user-1",
    toHash: HASH,
    status: "sent",
    provider: "ses",
    messageId,
    failures: [],
  });
};

const report = (
  messageId: string,
  status: "delivered" | "bounced" | "complained",
  from: ("sent" | "delivered" | "bounced")[],
  at = AT,
): Promise<void> =>
  deliveries.report({
    provider: "ses",
    messageId,
    status,
    from,
    at,
    detail: null,
  });

const statusOf = async (messageId: string): Promise<unknown> =>
  (await EmailDeliveryModel.findOne({ messageId }).lean())?.status;

describe("email suppressions against MongoDB", () => {
  beforeAll(async () => {
    await connect();
    await dropDatabase();
    await EmailSuppressionModel.syncIndexes();
    await EmailDeliveryModel.syncIndexes();
  });

  beforeEach(async () => {
    await EmailSuppressionModel.deleteMany({});
    await EmailDeliveryModel.deleteMany({});
  });

  afterAll(async () => {
    await dropDatabase();
    await disconnect();
  });

  it("keeps one row per address and finds deliveries by provider and message id", async () => {
    const suppressionIndexes = await EmailSuppressionModel.collection.indexes();
    expect(
      suppressionIndexes.find((index) => index.key.toHash === 1),
    ).toMatchObject({ unique: true });
    const deliveryIndexes = await EmailDeliveryModel.collection.indexes();
    expect(
      deliveryIndexes.find(
        (index) => index.key.provider === 1 && index.key.messageId === 1,
      ),
    ).toBeDefined();
  });

  it("suppresses once, keeps the first reason, lifts and suppresses again", async () => {
    await expect(suppressions.isSuppressed(HASH)).resolves.toBe(false);
    await expect(suppressions.suppress(bounceOf(HASH))).resolves.toBe(true);
    await expect(
      suppressions.suppress({
        ...bounceOf(HASH, new Date("2027-02-01T00:00:00Z")),
        reason: "complaint",
        detail: "abuse",
      }),
    ).resolves.toBe(false);
    expect(
      await EmailSuppressionModel.findOne({ toHash: HASH }).lean(),
    ).toMatchObject({
      reason: "bounce",
      detail: "Permanent/NoEmail",
      suppressedAt: AT,
      liftedAt: null,
    });
    await expect(suppressions.isSuppressed(HASH)).resolves.toBe(true);

    await expect(suppressions.lift(HASH)).resolves.toBe(true);
    await expect(suppressions.lift(HASH)).resolves.toBe(false);
    await expect(suppressions.isSuppressed(HASH)).resolves.toBe(false);

    const later = new Date("2027-03-01T00:00:00Z");
    await expect(
      suppressions.suppress({
        ...bounceOf(HASH, later),
        reason: "complaint",
        detail: "abuse",
      }),
    ).resolves.toBe(true);
    expect(
      await EmailSuppressionModel.findOne({ toHash: HASH }).lean(),
    ).toMatchObject({
      reason: "complaint",
      detail: "abuse",
      suppressedAt: later,
      liftedAt: null,
    });
    await expect(EmailSuppressionModel.countDocuments()).resolves.toBe(1);
  });

  it("counts one new suppression when the same event arrives many times at once", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => suppressions.suppress(bounceOf(HASH))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(EmailSuppressionModel.countDocuments()).resolves.toBe(1);
  });

  it("keeps a detail that looks like a field path as text", async () => {
    await suppressions.suppress({ ...bounceOf(HASH), detail: "$reason" });
    expect(
      await EmailSuppressionModel.findOne({ toHash: HASH }).lean(),
    ).toMatchObject({
      detail: "$reason",
    });
  });

  it("moves a delivery forward only, through its index", async () => {
    await sentRow("m-1");
    await report("m-1", "delivered", ["sent"]);
    expect(await statusOf("m-1")).toBe("delivered");
    await report("m-1", "bounced", ["sent", "delivered"]);
    expect(await statusOf("m-1")).toBe("bounced");
    const late = new Date("2027-01-05T00:00:00Z");
    await report("m-1", "delivered", ["sent"], late);
    expect(
      await EmailDeliveryModel.findOne({ messageId: "m-1" }).lean(),
    ).toMatchObject({ status: "bounced", reportedAt: AT });
    await report("unknown", "bounced", ["sent", "delivered"]);
    await expect(EmailDeliveryModel.countDocuments()).resolves.toBe(1);

    const plan = JSON.stringify(
      await EmailDeliveryModel.find({
        provider: "ses",
        messageId: "m-1",
        status: { $in: ["sent", "delivered"] },
      }).explain("queryPlanner"),
    );
    expect(plan).toContain("provider_1_messageId_1");
    expect(plan).not.toContain("COLLSCAN");
  });

  it("stops sending to an address once it hard-bounced", async () => {
    let sends = 0;
    const provider: EmailProvider = {
      name: "ses",
      send: async () => ({ messageId: `ses-${++sends}` }),
    };
    const email = new EmailService(
      [provider],
      new RateCounterRepository(),
      deliveries,
      suppressions,
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
          addressIntervalSeconds: 1,
          addressDailyMax: 50,
          userDailyMax: 50,
          deviceHourlyMax: 50,
          ipHourlyMax: 50,
        },
      },
    );
    const notice = (): Promise<EmailOutcome> =>
      email.sendNotice({
        template: "password-changed",
        data: { at: AT, userAgent: undefined },
        recipient: {
          userId: "user-1",
          email: "Gone@Email.test",
          locale: "en",
          timezone: "America/Bogota",
        },
      });

    await expect(notice()).resolves.toMatchObject({
      status: "sent",
      messageId: "ses-1",
    });
    await new EmailEventService(deliveries, suppressions).apply({
      provider: "ses",
      messageId: "ses-1",
      kind: "bounced",
      recipients: ["gone@email.test"],
      suppress: true,
      at: AT,
      detail: "Permanent/NoEmail",
    });
    await expect(notice()).resolves.toEqual({
      status: "failed",
      reason: "rejected",
    });
    expect(sends).toBe(1);

    const rows = await EmailDeliveryModel.find({})
      .sort({ createdAt: 1 })
      .lean();
    expect(rows.map((row) => row.status)).toEqual(["bounced", "suppressed"]);
  });
});
