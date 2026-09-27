import { EmailProvider } from "../../domain/email/EmailProvider";
import {
  IEmailDeliveryRepository,
  NewEmailDelivery,
} from "../../domain/repositories/emailDelivery/IEmailDeliveryRepository";
import { IEmailSuppressionRepository } from "../../domain/repositories/emailSuppression/IEmailSuppressionRepository";
import {
  CounterWindow,
  IRateCounterRepository,
  RateCount,
} from "../../domain/repositories/rateCounter/IRateCounterRepository";
import { EmailDeliveryStatus, EmailProviderName } from "../../shared/constants";
import { EmailBudget, emailBudgetSlices } from "../../shared/emailBudgets";
import { hashEmailAddress } from "../../shared/emailHash";
import { Locale } from "../../shared/locale";
import logger from "../../shared/logger";
import { sendThroughChain } from "../email/providerChain";
import {
  CodeTemplate,
  EMAIL_TEMPLATE_META,
  EmailTemplate,
  EmailTemplateData,
  NoticeTemplate,
  renderEmail,
} from "../email/templates";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface EmailRecipient {
  userId: string;
  email: string;
  locale: Locale;
  timezone: string;
}

export interface EmailRequester {
  ip: string;
  recognizedDevice: string | null;
}

export type EmailOutcome =
  | { status: "sent"; provider: EmailProviderName; messageId: string }
  | { status: "limited"; retryAfterSeconds: number }
  | {
      status: "failed";
      reason: "disabled" | "rejected" | "unavailable" | "unconfirmed";
    };

export interface EmailServiceConfig {
  enabled: boolean;
  from: { name: string; address: string };
  replyTo: string;
  appUrl: string;
  providerTimeoutMs: number;
  caps: {
    daily: number;
    monthly: number;
    resetPercent: number;
    otherPercent: number;
  };
  brakes: {
    addressIntervalSeconds: number;
    addressDailyMax: number;
    userDailyMax: number;
    deviceHourlyMax: number;
    ipHourlyMax: number;
  };
}

interface Brake {
  key: string;
  window: CounterWindow;
  max: number;
  costs: boolean;
  cap?: { budget: EmailBudget; period: "day" | "month" };
}

type BrakeResult =
  | { limited: false; costKeys: string[] }
  | { limited: true; retryAfterSeconds: number };

export type HeldBrakes =
  { limited: false } | { limited: true; retryAfterSeconds: number };

export class EmailService {
  constructor(
    private readonly providers: readonly EmailProvider[],
    private readonly counters: IRateCounterRepository,
    private readonly deliveries: IEmailDeliveryRepository,
    private readonly suppressions: IEmailSuppressionRepository,
    private readonly config: EmailServiceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Only the providers' share of a send: the brakes and the record add their MongoDB round trips.
  get providerCeilingMs(): number {
    return this.providers.length * this.config.providerTimeoutMs;
  }

  // Counts the brakes that depend only on who asks and for which address, account or not.
  async holdBrakes(request: {
    template: CodeTemplate;
    email: string;
    requester: EmailRequester;
  }): Promise<HeldBrakes> {
    const brakes = await this.consume(
      this.requestBrakes(
        request.template,
        hashEmailAddress(request.email),
        request.requester,
      ),
    );
    return brakes.limited ? brakes : { limited: false };
  }

  // brakesHeld: the caller already counted this request with holdBrakes, so only the rest is counted here.
  sendCode<T extends CodeTemplate>(request: {
    template: T;
    data: EmailTemplateData[T];
    recipient: EmailRecipient;
    requester: EmailRequester;
    brakesHeld?: boolean;
  }): Promise<EmailOutcome> {
    return this.deliver(
      request.template,
      request.data,
      request.recipient,
      request.requester,
      request.brakesHeld ?? false,
    );
  }

  sendNotice<T extends NoticeTemplate>(request: {
    template: T;
    data: EmailTemplateData[T];
    recipient: EmailRecipient;
  }): Promise<EmailOutcome> {
    return this.deliver(
      request.template,
      request.data,
      request.recipient,
      null,
      false,
    );
  }

  private async deliver<T extends EmailTemplate>(
    template: T,
    data: EmailTemplateData[T],
    recipient: EmailRecipient,
    requester: EmailRequester | null,
    brakesHeld: boolean,
  ): Promise<EmailOutcome> {
    const meta = EMAIL_TEMPLATE_META[template];
    const base = {
      template,
      budget: meta.budget,
      userId: recipient.userId,
      toHash: hashEmailAddress(recipient.email),
    };
    const isNotice = meta.kind === "notice";

    if (!this.config.enabled || this.providers.length === 0) {
      logger.warn(
        {
          code: "EMAIL_SENDING_DISABLED",
          template,
          configured: this.providers.length > 0,
        },
        "Email not sent: sending is switched off or has no provider",
      );
      if (isNotice) await this.record(base, "disabled");
      return { status: "failed", reason: "disabled" };
    }

    const rendered = renderEmail(template, data, {
      locale: recipient.locale,
      timezone: recipient.timezone,
      appUrl: this.config.appUrl,
      contact: this.config.replyTo,
    });

    let suppressed: boolean;
    try {
      suppressed = await this.suppressions.isSuppressed(base.toHash);
    } catch (err) {
      logger.error(
        { err, code: "EMAIL_SUPPRESSIONS_UNAVAILABLE", template },
        "Email not sent: the suppression list could not be read",
      );
      return { status: "failed", reason: "unavailable" };
    }
    if (suppressed) {
      logger.warn(
        { code: "EMAIL_RECIPIENT_SUPPRESSED", template },
        "Email not sent: the address bounced or complained before",
      );
      if (isNotice) await this.record(base, "suppressed");
      return { status: "failed", reason: "rejected" };
    }

    let brakes: BrakeResult;
    try {
      brakes = await this.consume([
        ...(brakesHeld
          ? []
          : this.requestBrakes(template, base.toHash, requester)),
        ...this.accountAndCapBrakes(template, recipient),
      ]);
    } catch (err) {
      logger.error(
        { err, code: "EMAIL_BRAKES_UNAVAILABLE", template },
        "Email not sent: its limits could not be counted",
      );
      return { status: "failed", reason: "unavailable" };
    }
    if (brakes.limited) {
      if (isNotice) await this.record(base, "limited");
      return { status: "limited", retryAfterSeconds: brakes.retryAfterSeconds };
    }

    const result = await sendThroughChain(
      this.providers,
      {
        to: recipient.email,
        from: this.config.from,
        replyTo: this.config.replyTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        template,
        budget: meta.budget,
      },
      this.config.providerTimeoutMs,
    );

    if (!result.accepted) {
      if (result.everyProviderRefused) await this.refund(brakes.costKeys);
      if (result.recipientRejected) {
        logger.warn(
          {
            code: "EMAIL_RECIPIENT_REJECTED",
            template,
            failures: result.failures,
          },
          "Email not sent: the provider refused the address",
        );
      } else {
        logger.error(
          { code: "EMAIL_SEND_FAILED", template, failures: result.failures },
          "Email not sent: no provider accepted it",
        );
      }
      await this.record(base, "failed", { failures: result.failures });
      return {
        status: "failed",
        reason: result.recipientRejected
          ? "rejected"
          : result.everyProviderRefused
            ? "unavailable"
            : "unconfirmed",
      };
    }

    if (result.failures.length > 0) {
      logger.warn(
        {
          code: "EMAIL_PROVIDER_FAILED",
          template,
          provider: result.provider,
          failures: result.failures,
        },
        "Email sent by a fallback provider",
      );
    }
    await this.record(base, "sent", {
      provider: result.provider,
      messageId: result.messageId,
      failures: result.failures,
    });
    return {
      status: "sent",
      provider: result.provider,
      messageId: result.messageId,
    };
  }

  private requestBrakes(
    template: EmailTemplate,
    toHash: string,
    requester: EmailRequester | null,
  ): Brake[] {
    const meta = EMAIL_TEMPLATE_META[template];
    const { brakes } = this.config;
    const list: Brake[] = [
      {
        key: `email-address:${meta.purpose}:${toHash}`,
        window: { lengthMs: brakes.addressIntervalSeconds * 1000 },
        max: 1,
        costs: false,
      },
    ];
    if (meta.addressDaily) {
      list.push({
        key: `email-address-day:${meta.purpose}:${toHash}`,
        window: { lengthMs: DAY_MS },
        max: brakes.addressDailyMax,
        costs: false,
      });
    }
    if (requester) {
      list.push(
        requester.recognizedDevice
          ? {
              key: `email-device:${requester.recognizedDevice}`,
              window: { lengthMs: HOUR_MS },
              max: brakes.deviceHourlyMax,
              costs: false,
            }
          : {
              key: `email-ip:${requester.ip}`,
              window: { lengthMs: HOUR_MS },
              max: brakes.ipHourlyMax,
              costs: false,
            },
      );
    }
    return list;
  }

  private accountAndCapBrakes(
    template: EmailTemplate,
    recipient: EmailRecipient,
  ): Brake[] {
    const meta = EMAIL_TEMPLATE_META[template];
    const { brakes, caps } = this.config;
    const list: Brake[] = [];
    if (meta.perUser) {
      list.push({
        key: `email-user:${recipient.userId}`,
        window: { lengthMs: DAY_MS },
        max: brakes.userDailyMax,
        costs: false,
      });
    }

    const now = this.now();
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const dayEnds = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const monthEnds = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const daily = emailBudgetSlices(
      caps.daily,
      caps.resetPercent,
      caps.otherPercent,
    );
    const monthly = emailBudgetSlices(
      caps.monthly,
      caps.resetPercent,
      caps.otherPercent,
    );
    list.push(
      {
        key: `email-cap:${meta.budget}:${day}`,
        window: { endsAt: dayEnds },
        max: daily[meta.budget],
        costs: true,
        cap: { budget: meta.budget, period: "day" },
      },
      {
        key: `email-cap:${meta.budget}:${month}`,
        window: { endsAt: monthEnds },
        max: monthly[meta.budget],
        costs: true,
        cap: { budget: meta.budget, period: "month" },
      },
    );
    return list;
  }

  private async consume(brakes: Brake[]): Promise<BrakeResult> {
    const settled = await Promise.allSettled(
      brakes.map((brake) => this.counters.hit(brake.key, brake.window)),
    );
    const passedKeys = brakes
      .filter((brake, i) => {
        const hit = settled[i];
        return hit.status === "fulfilled" && hit.value.count <= brake.max;
      })
      .map((brake) => brake.key);
    const storeError = settled.find((hit) => hit.status === "rejected");
    if (storeError) {
      await this.refund(passedKeys);
      throw storeError.reason;
    }

    const counts = settled.map(
      (hit) => (hit as PromiseFulfilledResult<RateCount>).value,
    );
    const over = brakes
      .map((brake, i) => ({ brake, counted: counts[i] }))
      .filter(({ brake, counted }) => counted.count > brake.max);
    if (over.length === 0) {
      return {
        limited: false,
        costKeys: brakes.filter((b) => b.costs).map((b) => b.key),
      };
    }

    await this.refund(passedKeys);
    for (const { brake, counted } of over) {
      if (brake.cap && counted.count === brake.max + 1) {
        logger.error(
          { code: "EMAIL_CAP_REACHED", ...brake.cap, max: brake.max },
          "A sending cap is reached: emails of this budget stop until it frees",
        );
      }
    }
    const frees = Math.max(
      ...over.map(({ counted }) => counted.expiresAt.getTime()),
    );
    return {
      limited: true,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((frees - this.now().getTime()) / 1000),
      ),
    };
  }

  private async refund(keys: string[]): Promise<void> {
    const results = await Promise.allSettled(
      keys.map((key) => this.counters.refund(key)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      logger.error(
        { code: "EMAIL_REFUND_FAILED", failed },
        "Email limit counters could not be given back; they over-count until their window ends",
      );
    }
  }

  private async record(
    base: Pick<NewEmailDelivery, "template" | "budget" | "userId" | "toHash">,
    status: EmailDeliveryStatus,
    extra: Partial<
      Pick<NewEmailDelivery, "provider" | "messageId" | "failures">
    > = {},
  ): Promise<void> {
    try {
      await this.deliveries.record({
        ...base,
        status,
        provider: extra.provider ?? null,
        messageId: extra.messageId ?? null,
        failures: extra.failures ?? [],
      });
    } catch (err) {
      logger.error(
        {
          err,
          code: "EMAIL_DELIVERY_NOT_RECORDED",
          template: base.template,
          status,
        },
        "Email delivery could not be recorded",
      );
    }
  }
}
