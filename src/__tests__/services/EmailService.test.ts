jest.mock("../../shared/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

import {
  EmailOutcome,
  EmailRecipient,
  EmailRequester,
  EmailService,
  EmailServiceConfig,
  HeldBrakes,
} from "../../app/services/EmailService";
import {
  EmailProvider,
  EmailProviderError,
} from "../../domain/email/EmailProvider";
import {
  IEmailDeliveryRepository,
  NewEmailDelivery,
} from "../../domain/repositories/emailDelivery/IEmailDeliveryRepository";
import {
  IEmailSuppressionRepository,
  NewEmailSuppression,
} from "../../domain/repositories/emailSuppression/IEmailSuppressionRepository";
import {
  CounterWindow,
  IRateCounterRepository,
  RateCount,
} from "../../domain/repositories/rateCounter/IRateCounterRepository";
import { hashEmailAddress } from "../../shared/emailHash";
import logger from "../../shared/logger";

class MemoryCounters implements IRateCounterRepository {
  readonly counts = new Map<string, RateCount>();
  failNext = false;

  constructor(private readonly clock: () => Date) {}

  async hit(key: string, window: CounterWindow): Promise<RateCount> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("store down");
    }
    const now = this.clock().getTime();
    const current = this.counts.get(key);
    const next =
      current && current.expiresAt.getTime() > now
        ? { count: current.count + 1, expiresAt: current.expiresAt }
        : {
            count: 1,
            expiresAt:
              "lengthMs" in window
                ? new Date(now + window.lengthMs)
                : window.endsAt,
          };
    this.counts.set(key, next);
    return next;
  }

  async refund(key: string): Promise<void> {
    const current = this.counts.get(key);
    if (current && current.count > 0) {
      this.counts.set(key, { ...current, count: current.count - 1 });
    }
  }

  count(prefix: string): number {
    return [...this.counts.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .reduce((sum, [, value]) => sum + value.count, 0);
  }
}

class MemoryDeliveries implements IEmailDeliveryRepository {
  readonly rows: NewEmailDelivery[] = [];
  fail = false;

  async record(delivery: NewEmailDelivery): Promise<void> {
    if (this.fail) throw new Error("insert failed");
    this.rows.push(delivery);
  }

  async report(): Promise<void> {}
}

class MemorySuppressions implements IEmailSuppressionRepository {
  readonly hashes = new Set<string>();
  fail = false;

  async isSuppressed(toHash: string): Promise<boolean> {
    if (this.fail) throw new Error("read failed");
    return this.hashes.has(toHash);
  }

  async suppress(suppression: NewEmailSuppression): Promise<boolean> {
    const added = !this.hashes.has(suppression.toHash);
    this.hashes.add(suppression.toHash);
    return added;
  }

  async lift(toHash: string): Promise<boolean> {
    return this.hashes.delete(toHash);
  }
}

const CONFIG: EmailServiceConfig = {
  enabled: true,
  from: { name: "Ledger Flow", address: "no-reply@ledgerflow.alexpiral.com" },
  replyTo: "ledgerflow@alexpiral.com",
  appUrl: "https://ledgerflow.alexpiral.com",
  providerTimeoutMs: 1500,
  caps: { daily: 10, monthly: 100, resetPercent: 30, otherPercent: 20 },
  brakes: {
    addressIntervalSeconds: 60,
    addressDailyMax: 5,
    userDailyMax: 5,
    deviceHourlyMax: 10,
    ipHourlyMax: 10,
  },
};

const RECIPIENT: EmailRecipient = {
  userId: "user-1",
  email: "Ana@Example.com",
  locale: "es",
  timezone: "America/Bogota",
};
const REQUESTER: EmailRequester = { ip: "203.0.113.7", recognizedDevice: null };
const CODE = { code: "482913", token: "q7Xk2mVb9RtL4wPz" };
const FACTS = { at: new Date("2026-09-26T12:00:00Z"), userAgent: undefined };

describe("EmailService", () => {
  let now: Date;
  let counters: MemoryCounters;
  let deliveries: MemoryDeliveries;
  let suppressions: MemorySuppressions;
  let sent: { to: string; subject: string; template: string }[];
  let provider: EmailProvider & { send: jest.Mock };

  const service = (
    config: Partial<EmailServiceConfig> = {},
    providers: EmailProvider[] = [provider],
  ): EmailService =>
    new EmailService(
      providers,
      counters,
      deliveries,
      suppressions,
      {
        ...CONFIG,
        ...config,
        caps: { ...CONFIG.caps, ...config.caps },
        brakes: { ...CONFIG.brakes, ...config.brakes },
      },
      () => now,
    );

  const reset = (
    svc: EmailService,
    email = RECIPIENT.email,
  ): Promise<EmailOutcome> =>
    svc.sendCode({
      template: "password-reset",
      data: CODE,
      recipient: { ...RECIPIENT, email },
      requester: REQUESTER,
    });

  const advance = (ms: number): void => {
    now = new Date(now.getTime() + ms);
  };

  beforeEach(() => {
    now = new Date("2026-09-26T12:00:00Z");
    counters = new MemoryCounters(() => now);
    deliveries = new MemoryDeliveries();
    suppressions = new MemorySuppressions();
    sent = [];
    provider = {
      name: "mailpit",
      send: jest.fn(async (email) => {
        sent.push(email);
        return { messageId: `m-${sent.length}` };
      }),
    };
  });

  it("renders in the account's language and records the send by hash only", async () => {
    const outcome = await reset(service());

    expect(outcome).toEqual({
      status: "sent",
      provider: "mailpit",
      messageId: "m-1",
    });
    expect(sent[0]).toMatchObject({
      to: RECIPIENT.email,
      subject: "Restablece tu contraseña de Ledger Flow",
      template: "password-reset",
    });
    expect(deliveries.rows).toEqual([
      {
        template: "password-reset",
        budget: "reset",
        userId: "user-1",
        toHash: hashEmailAddress("ana@example.com"),
        status: "sent",
        provider: "mailpit",
        messageId: "m-1",
        failures: [],
      },
    ]);
    expect(JSON.stringify(deliveries.rows)).not.toContain("xample.com");
  });

  describe("the suppression list", () => {
    it("refuses an address that bounced or complained, before counting or sending", async () => {
      suppressions.hashes.add(hashEmailAddress(RECIPIENT.email));
      await expect(reset(service())).resolves.toEqual({
        status: "failed",
        reason: "rejected",
      });
      expect(provider.send).not.toHaveBeenCalled();
      expect(counters.counts.size).toBe(0);
      expect(deliveries.rows).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_RECIPIENT_SUPPRESSED" }),
        expect.any(String),
      );
    });

    it("matches the address whatever its case or spacing", async () => {
      suppressions.hashes.add(hashEmailAddress("ana@example.com"));
      await expect(
        reset(service(), "  ANA@example.COM "),
      ).resolves.toMatchObject({ status: "failed", reason: "rejected" });
    });

    it("keeps a suppressed security notice on the record", async () => {
      suppressions.hashes.add(hashEmailAddress(RECIPIENT.email));
      await service().sendNotice({
        template: "password-changed",
        data: FACTS,
        recipient: RECIPIENT,
      });
      expect(deliveries.rows).toEqual([
        expect.objectContaining({
          template: "password-changed",
          status: "suppressed",
          provider: null,
        }),
      ]);
    });

    it("sends to another address as usual", async () => {
      suppressions.hashes.add(hashEmailAddress("someone@else.test"));
      await expect(reset(service())).resolves.toMatchObject({
        status: "sent",
      });
    });

    it("does not send when the list cannot be read", async () => {
      suppressions.fail = true;
      await expect(reset(service())).resolves.toEqual({
        status: "failed",
        reason: "unavailable",
      });
      expect(provider.send).not.toHaveBeenCalled();
      expect(counters.counts.size).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_SUPPRESSIONS_UNAVAILABLE" }),
        expect.any(String),
      );
    });
  });

  describe("the switch", () => {
    it("sends nothing and counts nothing when sending is off", async () => {
      const outcome = await reset(service({ enabled: false }));
      expect(outcome).toEqual({ status: "failed", reason: "disabled" });
      expect(provider.send).not.toHaveBeenCalled();
      expect(counters.counts.size).toBe(0);
      expect(deliveries.rows).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_SENDING_DISABLED" }),
        expect.any(String),
      );
    });

    it("treats no provider as off, and keeps a notice on the record", async () => {
      const outcome = await service({}, []).sendNotice({
        template: "password-changed",
        data: FACTS,
        recipient: RECIPIENT,
      });
      expect(outcome).toEqual({ status: "failed", reason: "disabled" });
      expect(deliveries.rows).toMatchObject([{ status: "disabled" }]);
    });
  });

  describe("per address", () => {
    it("allows one per minute and answers when the next one can go", async () => {
      const svc = service();
      await reset(svc);
      advance(15_000);
      await expect(reset(svc)).resolves.toEqual({
        status: "limited",
        retryAfterSeconds: 45,
      });
      advance(45_000);
      await expect(reset(svc)).resolves.toMatchObject({ status: "sent" });
    });

    it("counts the same address whatever its case or spaces", async () => {
      const svc = service();
      await reset(svc, "ana@example.com");
      await expect(reset(svc, "  ANA@example.com ")).resolves.toMatchObject({
        status: "limited",
      });
    });

    it("stops at five a day", async () => {
      const svc = service({ caps: { ...CONFIG.caps, daily: 1000 } });
      for (let i = 0; i < 5; i++) {
        await expect(reset(svc)).resolves.toMatchObject({ status: "sent" });
        advance(61_000);
      }
      await expect(reset(svc)).resolves.toMatchObject({ status: "limited" });
    });

    it("keeps purposes apart: a reset never waits on a verification", async () => {
      const svc = service();
      await svc.sendCode({
        template: "verify-email",
        data: { ...CODE, notMeToken: "q7Xk2mVb9RtL4wPzNM" },
        recipient: RECIPIENT,
        requester: REQUESTER,
      });
      await expect(reset(svc)).resolves.toMatchObject({ status: "sent" });
    });

    it("does not count a limited attempt against the brakes it passed", async () => {
      const svc = service({ brakes: { ...CONFIG.brakes, ipHourlyMax: 1 } });
      await reset(svc, "one@example.com");
      await expect(reset(svc, "two@example.com")).resolves.toMatchObject({
        status: "limited",
      });
      expect(
        counters.counts.get(
          `email-address:reset:${hashEmailAddress("two@example.com")}`,
        )?.count,
      ).toBe(0);
    });
  });

  it("never makes the email after an undo wait on the forgot-password brakes", async () => {
    const svc = service({ caps: { ...CONFIG.caps, daily: 1000 } });
    for (let i = 0; i < 5; i++) {
      await reset(svc);
      advance(61_000);
    }
    await expect(reset(svc)).resolves.toMatchObject({ status: "limited" });
    await expect(
      svc.sendCode({
        template: "password-reset-after-undo",
        data: CODE,
        recipient: RECIPIENT,
        requester: { ...REQUESTER, ip: "198.51.100.9" },
      }),
    ).resolves.toMatchObject({ status: "sent" });
  });

  it("counts a code sent with no requester, the undo's, on no IP or device [T-211]", async () => {
    const svc = service({ caps: { ...CONFIG.caps, daily: 1000 } });
    for (let i = 0; i < 6; i++) {
      await expect(
        svc.sendCode({
          template: "password-reset-after-undo",
          data: CODE,
          recipient: { ...RECIPIENT, email: `owner${i}@example.com` },
          requester: null,
        }),
      ).resolves.toMatchObject({ status: "sent" });
    }
    expect(counters.count("email-ip:")).toBe(0);
  });

  describe("per account", () => {
    const verify = (svc: EmailService, email: string): Promise<EmailOutcome> =>
      svc.sendCode({
        template: "email-change-confirm",
        data: CODE,
        recipient: { ...RECIPIENT, email },
        requester: { ...REQUESTER, recognizedDevice: "device-1" },
      });

    it("caps what one account sends to any address in a day", async () => {
      const svc = service();
      for (let i = 0; i < 5; i++) {
        await expect(verify(svc, `new${i}@example.com`)).resolves.toMatchObject(
          { status: "sent" },
        );
      }
      await expect(verify(svc, "new5@example.com")).resolves.toMatchObject({
        status: "limited",
      });
    });

    it("leaves the reset out of it", async () => {
      const svc = service({ caps: { ...CONFIG.caps, daily: 1000 } });
      for (let i = 0; i < 6; i++) {
        await expect(reset(svc, `a${i}@example.com`)).resolves.toMatchObject({
          status: "sent",
        });
      }
      expect(counters.count("email-user:")).toBe(0);
    });
  });

  describe("per requester", () => {
    it("counts a recognized device on its own, not on the shared address", async () => {
      const svc = service({ caps: { ...CONFIG.caps, daily: 1000 } });
      const onDevice = (
        email: string,
        recognizedDevice: string,
      ): Promise<EmailOutcome> =>
        svc.sendCode({
          template: "password-reset",
          data: CODE,
          recipient: { ...RECIPIENT, email },
          requester: { ip: REQUESTER.ip, recognizedDevice },
        });
      for (let i = 0; i < 10; i++) {
        await onDevice(`d${i}@example.com`, "device-1");
      }
      await expect(
        onDevice("d10@example.com", "device-1"),
      ).resolves.toMatchObject({ status: "limited" });
      await expect(
        onDevice("d11@example.com", "device-2"),
      ).resolves.toMatchObject({ status: "sent" });
      await expect(reset(svc, "anon@example.com")).resolves.toMatchObject({
        status: "sent",
      });
      expect(counters.count(`email-ip:${REQUESTER.ip}`)).toBe(1);
    });

    it("counts an unrecognized request on its IP", async () => {
      const svc = service({ caps: { ...CONFIG.caps, daily: 1000 } });
      for (let i = 0; i < 10; i++) {
        await reset(svc, `ip${i}@example.com`);
      }
      await expect(reset(svc, "ip10@example.com")).resolves.toMatchObject({
        status: "limited",
      });
    });

    it("never brakes a security notice on the requester", async () => {
      const svc = service();
      await svc.sendNotice({
        template: "new-sign-in",
        data: FACTS,
        recipient: RECIPIENT,
      });
      expect(counters.count("email-ip:")).toBe(0);
      expect(counters.count("email-device:")).toBe(0);
    });
  });

  describe("the sending caps", () => {
    const notice = (svc: EmailService, i: number): Promise<EmailOutcome> =>
      svc.sendNotice({
        template: "password-changed",
        data: FACTS,
        recipient: { ...RECIPIENT, email: `n${i}@example.com` },
      });

    it("gives the reset its own share, so filling the rest never blocks one", async () => {
      const svc = service();
      for (let i = 0; i < 5; i++) {
        await expect(notice(svc, i)).resolves.toMatchObject({ status: "sent" });
      }
      await expect(notice(svc, 5)).resolves.toMatchObject({
        status: "limited",
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "EMAIL_CAP_REACHED",
          budget: "security",
          period: "day",
        }),
        expect.any(String),
      );
      await expect(reset(svc)).resolves.toMatchObject({ status: "sent" });
    });

    it("logs a reached cap once, not on every attempt it stops", async () => {
      const svc = service();
      for (let i = 0; i < 9; i++) await notice(svc, i);
      const reached = (logger.error as jest.Mock).mock.calls.filter(
        ([fields]) => fields.code === "EMAIL_CAP_REACHED",
      );
      expect(reached).toHaveLength(1);
    });

    it("keeps a limited notice on the record", async () => {
      const svc = service();
      for (let i = 0; i < 6; i++) await notice(svc, i);
      expect(deliveries.rows.map((r) => r.status)).toEqual([
        "sent",
        "sent",
        "sent",
        "sent",
        "sent",
        "limited",
      ]);
    });

    it("opens the day again at midnight UTC and holds the month", async () => {
      const svc = service({
        caps: { ...CONFIG.caps, daily: 10, monthly: 12 },
      });
      for (let i = 0; i < 6; i++) await notice(svc, i);
      now = new Date("2026-09-27T00:00:01Z");
      await expect(notice(svc, 6)).resolves.toMatchObject({ status: "sent" });
      await expect(notice(svc, 7)).resolves.toMatchObject({ status: "sent" });
      await expect(notice(svc, 8)).resolves.toMatchObject({
        status: "limited",
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_CAP_REACHED", period: "month" }),
        expect.any(String),
      );
      expect(
        counters.counts.get("email-cap:security:2026-09")?.expiresAt,
      ).toEqual(new Date("2026-10-01T00:00:00Z"));
    });

    it("gives back what a failed send did not spend, and keeps the requester's try [T-228]", async () => {
      provider.send.mockRejectedValue(
        new EmailProviderError("mailpit", "transport", "HTTP 500", {
          outcome: "refused",
        }),
      );
      const outcome = await reset(service());
      expect(outcome).toEqual({ status: "failed", reason: "unavailable" });
      expect(counters.count("email-cap:")).toBe(0);
      expect(counters.count("email-address:")).toBe(0);
      expect(counters.count("email-address-day:")).toBe(0);
      expect(counters.count("email-ip:")).toBe(1);
      expect(deliveries.rows).toMatchObject([
        {
          status: "failed",
          provider: null,
          failures: [{ provider: "mailpit", error: "HTTP 500" }],
        },
      ]);
    });
  });

  describe("failures", () => {
    it("says the address was refused, as a warning and not an outage", async () => {
      provider.send.mockRejectedValue(
        new EmailProviderError("mailpit", "recipient", "HTTP 400", {
          outcome: "refused",
        }),
      );
      await expect(reset(service())).resolves.toEqual({
        status: "failed",
        reason: "rejected",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_RECIPIENT_REJECTED" }),
        expect.any(String),
      );
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_SEND_FAILED" }),
        expect.any(String),
      );
    });

    it("keeps the cap when a timeout leaves it unknown whether the email went out", async () => {
      provider.send.mockRejectedValue(
        new EmailProviderError("mailpit", "transport", "Timeout"),
      );
      await expect(reset(service())).resolves.toEqual({
        status: "failed",
        reason: "unconfirmed",
      });
      expect(counters.count("email-cap:")).toBe(2);
    });

    it("gives back what it counted when the store fails part-way", async () => {
      const failing = new MemoryCounters(() => now);
      let calls = 0;
      const realHit = failing.hit.bind(failing);
      failing.hit = async (key, window) => {
        calls += 1;
        if (calls === 3) throw new Error("store down");
        return realHit(key, window);
      };
      counters = failing;
      await expect(reset(service())).resolves.toEqual({
        status: "failed",
        reason: "unavailable",
      });
      expect(failing.count("")).toBe(0);
    });

    it("does not send when its limits cannot be counted", async () => {
      counters.failNext = true;
      await expect(reset(service())).resolves.toEqual({
        status: "failed",
        reason: "unavailable",
      });
      expect(provider.send).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_BRAKES_UNAVAILABLE" }),
        expect.any(String),
      );
    });

    it("still answers sent when only the record fails", async () => {
      deliveries.fail = true;
      await expect(reset(service())).resolves.toMatchObject({ status: "sent" });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_DELIVERY_NOT_RECORDED" }),
        expect.any(String),
      );
    });

    it("records the provider that failed before a fallback sent it", async () => {
      const broken: EmailProvider = {
        name: "ses",
        send: jest.fn(async () => {
          throw new EmailProviderError("ses", "transport", "Timeout");
        }),
      };
      const outcome = await service({}, [broken, provider]).sendNotice({
        template: "new-sign-in",
        data: FACTS,
        recipient: RECIPIENT,
      });
      expect(outcome).toMatchObject({ status: "sent", provider: "mailpit" });
      expect(deliveries.rows[0].failures).toEqual([
        { provider: "ses", error: "Timeout" },
      ]);
    });

    describe("a network error", () => {
      const networkFailure = (code: string): EmailProviderError =>
        new EmailProviderError("mailpit", "transport", "Error", {
          outcome: code === "ECONNRESET" ? "mayHaveSent" : "neverLeft",
          cause: Object.assign(new Error(`connect ${code} ana@example.com`), {
            code,
          }),
        });

      it("records and logs why it failed, without the address", async () => {
        provider.send.mockRejectedValue(networkFailure("ECONNRESET"));
        await expect(reset(service())).resolves.toEqual({
          status: "failed",
          reason: "unconfirmed",
        });
        const failures = [
          {
            provider: "mailpit",
            error: "Error",
            detail: "ECONNRESET · connect ECONNRESET [address]",
          },
        ];
        expect(deliveries.rows[0].failures).toEqual(failures);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ code: "EMAIL_SEND_FAILED", failures }),
          expect.any(String),
        );
      });

      it("gives back what a send that never left did not spend", async () => {
        provider.send.mockRejectedValue(networkFailure("EAI_AGAIN"));
        await expect(reset(service())).resolves.toEqual({
          status: "failed",
          reason: "unavailable",
        });
        expect(provider.send).toHaveBeenCalledTimes(2);
        expect(counters.count("email-cap:")).toBe(0);
      });

      it("says the same provider sent it on its second try", async () => {
        provider.send.mockRejectedValueOnce(networkFailure("EAI_AGAIN"));
        await expect(reset(service())).resolves.toMatchObject({
          status: "sent",
          provider: "mailpit",
        });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            code: "EMAIL_SEND_RETRIED",
            provider: "mailpit",
          }),
          expect.any(String),
        );
        expect(logger.warn).not.toHaveBeenCalledWith(
          expect.objectContaining({ code: "EMAIL_PROVIDER_FAILED" }),
          expect.any(String),
        );
        expect(deliveries.rows[0]).toMatchObject({
          status: "sent",
          failures: [{ provider: "mailpit", error: "Error" }],
        });
      });
    });

    it("warns when a send took more than half of its timeout", async () => {
      jest.useFakeTimers({ now: new Date("2026-09-26T12:00:00Z") });
      try {
        provider.send.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 900));
          return { messageId: "slow-1" };
        });
        const sending = reset(service());
        await jest.advanceTimersByTimeAsync(900);
        await expect(sending).resolves.toMatchObject({ status: "sent" });
      } finally {
        jest.useRealTimers();
      }
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "EMAIL_SEND_SLOW",
          template: "password-reset",
          provider: "mailpit",
          durationMs: 900,
        }),
        expect.any(String),
      );
    });

    it("times only the provider that sent it, not one that timed out before", async () => {
      jest.useFakeTimers({ now: new Date("2026-09-26T12:00:00Z") });
      try {
        const hangs: EmailProvider = {
          name: "ses",
          send: jest.fn(() => new Promise<never>(() => undefined)),
        };
        const sending = service({}, [hangs, provider]).sendNotice({
          template: "new-sign-in",
          data: FACTS,
          recipient: RECIPIENT,
        });
        await jest.advanceTimersByTimeAsync(1500);
        await expect(sending).resolves.toMatchObject({
          status: "sent",
          provider: "mailpit",
        });
      } finally {
        jest.useRealTimers();
      }
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_PROVIDER_FAILED" }),
        expect.any(String),
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_SEND_SLOW" }),
        expect.any(String),
      );
    });

    it("says nothing about a send that took its usual time", async () => {
      await reset(service());
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ code: "EMAIL_SEND_SLOW" }),
        expect.any(String),
      );
    });

    it("refuses a malformed input before counting anything", async () => {
      await expect(
        service().sendCode({
          template: "password-reset",
          data: { code: "1", token: CODE.token },
          recipient: RECIPIENT,
          requester: REQUESTER,
        }),
      ).rejects.toThrow(/malformed/);
      expect(counters.counts.size).toBe(0);
    });
  });

  describe("brakes held before the account is known [T-207]", () => {
    const hold = (
      svc: EmailService,
      email = RECIPIENT.email,
    ): Promise<HeldBrakes> =>
      svc.holdBrakes({
        template: "password-reset",
        email,
        requester: REQUESTER,
      });

    it("counts an address that has no account exactly like one that has", async () => {
      const svc = service();
      await expect(hold(svc, "nobody@example.com")).resolves.toEqual({
        limited: false,
      });
      advance(15_000);
      await expect(hold(svc, "NOBODY@example.com ")).resolves.toEqual({
        limited: true,
        retryAfterSeconds: 45,
      });
      expect(sent).toHaveLength(0);
    });

    it("counts the requester too, whatever address it asks for", async () => {
      const svc = service({ brakes: { ...CONFIG.brakes, ipHourlyMax: 2 } });
      await hold(svc, "one@example.com");
      await hold(svc, "two@example.com");
      await expect(hold(svc, "three@example.com")).resolves.toMatchObject({
        limited: true,
      });
    });

    it("leaves the caps to the send, which counts nothing held again", async () => {
      const svc = service();
      await hold(svc);
      await expect(
        svc.sendCode({
          template: "password-reset",
          data: CODE,
          recipient: RECIPIENT,
          requester: REQUESTER,
          brakesHeld: true,
        }),
      ).resolves.toMatchObject({ status: "sent" });
      expect(counters.count("email-address:")).toBe(1);
      expect(counters.count("email-ip:")).toBe(1);
      expect(counters.count("email-cap:reset:")).toBe(2);
    });

    it("keeps the address brakes it held when the send leaves nothing [T-228]", async () => {
      const svc = service();
      provider.send.mockRejectedValue(
        new EmailProviderError("mailpit", "transport", "HTTP 500", {
          outcome: "refused",
        }),
      );
      await hold(svc);
      await expect(
        svc.sendCode({
          template: "password-reset",
          data: CODE,
          recipient: RECIPIENT,
          requester: REQUESTER,
          brakesHeld: true,
        }),
      ).resolves.toEqual({ status: "failed", reason: "unavailable" });
      expect(counters.count("email-address:")).toBe(1);
      expect(counters.count("email-cap:")).toBe(0);
    });

    it("counts no cap for an address nothing is sent to", async () => {
      await hold(service(), "nobody@example.com");
      expect(counters.count("email-cap:")).toBe(0);
    });

    it("throws when the store cannot count, so the caller answers every address alike", async () => {
      const svc = service();
      counters.failNext = true;
      await expect(hold(svc)).rejects.toThrow("store down");
    });
  });

  it("knows the longest a send can take", () => {
    const broken: EmailProvider = { name: "ses", send: jest.fn() };
    expect(service({}, [broken, provider]).providerCeilingMs).toBe(3000);
  });
});
