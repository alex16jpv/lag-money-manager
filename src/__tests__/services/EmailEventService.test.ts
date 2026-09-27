jest.mock("../../shared/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

import { EmailEventService } from "../../app/services/EmailEventService";
import { EmailEvent } from "../../domain/email/EmailEvent";
import { IEmailDeliveryRepository } from "../../domain/repositories/emailDelivery/IEmailDeliveryRepository";
import { IEmailSuppressionRepository } from "../../domain/repositories/emailSuppression/IEmailSuppressionRepository";
import { hashEmailAddress } from "../../shared/emailHash";
import logger from "../../shared/logger";

const AT = new Date("2027-01-01T10:00:05Z");

const bounce = (overrides: Partial<EmailEvent> = {}): EmailEvent => ({
  provider: "ses",
  messageId: "m-1",
  kind: "bounced",
  recipients: ["ana@example.com"],
  suppress: true,
  at: AT,
  detail: "Permanent/NoEmail",
  ...overrides,
});

describe("EmailEventService", () => {
  let deliveries: jest.Mocked<IEmailDeliveryRepository>;
  let suppressions: jest.Mocked<IEmailSuppressionRepository>;
  let service: EmailEventService;

  beforeEach(() => {
    deliveries = {
      record: jest.fn(),
      report: jest.fn().mockResolvedValue(undefined),
    };
    suppressions = {
      isSuppressed: jest.fn(),
      suppress: jest.fn().mockResolvedValue(true),
      lift: jest.fn(),
    };
    service = new EmailEventService(deliveries, suppressions);
  });

  it("suppresses a hard bounce by hash and moves its record", async () => {
    await service.apply(bounce());
    expect(suppressions.suppress).toHaveBeenCalledWith({
      toHash: hashEmailAddress("ana@example.com"),
      reason: "bounce",
      provider: "ses",
      detail: "Permanent/NoEmail",
      at: AT,
    });
    expect(deliveries.report).toHaveBeenCalledWith({
      provider: "ses",
      messageId: "m-1",
      status: "bounced",
      from: ["sent", "delivered"],
      at: AT,
      detail: "Permanent/NoEmail",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "EMAIL_ADDRESS_SUPPRESSED",
        reason: "bounce",
      }),
      expect.any(String),
    );
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain(
      "example.com",
    );
  });

  it("records a complaint as a complaint", async () => {
    await service.apply(bounce({ kind: "complained", detail: "abuse" }));
    expect(suppressions.suppress).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "complaint" }),
    );
    expect(deliveries.report).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "complained",
        from: ["sent", "delivered", "bounced"],
      }),
    );
  });

  it("does not log an address that was already suppressed", async () => {
    suppressions.suppress.mockResolvedValue(false);
    await service.apply(bounce());
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("suppresses each address once, whatever its case", async () => {
    await service.apply(
      bounce({
        recipients: ["ana@example.com", "ANA@example.com", "luis@example.com"],
      }),
    );
    expect(suppressions.suppress).toHaveBeenCalledTimes(2);
  });

  it("only moves the record of a soft bounce or a delivery", async () => {
    await service.apply(
      bounce({ suppress: false, detail: "Transient/MailboxFull" }),
    );
    await service.apply(
      bounce({ kind: "delivered", suppress: false, detail: null }),
    );
    expect(suppressions.suppress).not.toHaveBeenCalled();
    expect(deliveries.report).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "delivered", from: ["sent"] }),
    );
  });

  it("lets a store failure through, so the provider retries", async () => {
    suppressions.suppress.mockRejectedValue(new Error("down"));
    await expect(service.apply(bounce())).rejects.toThrow("down");
  });
});
