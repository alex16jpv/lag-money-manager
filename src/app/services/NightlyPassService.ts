import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { IUserDataEraser } from "../../domain/repositories/userData/IUserDataEraser";
import {
  CONFIRM_DEADLINE_DAYS,
  CONFIRM_REMINDER_DAYS,
  dayAfter,
  daysUntil,
} from "../../shared/accountDays";
import logger from "../../shared/logger";
import { newAccountLinkToken, tokenDigest } from "./authCodes";
import { keptUntilFrom } from "./deletedAccount";
import { EmailOutcome, EmailService } from "./EmailService";
import { mayHaveArrived } from "./securityNotice";

const BATCH = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface NightlyPassConfig {
  deadlines: boolean;
  // A night's share of the daily cap, so the deadline emails never starve the codes people ask for.
  deadlineEmailsPerNight: number;
}

export interface NightlyReport {
  dated: number;
  erased: number;
  eraseFailed: number;
  deadlines: number;
  reminders: number;
}

// Only an email that went spends the night's share: an address that refuses mail must not starve the rest.
type Sending = "sent" | "skipped" | "stop";

export class NightlyPassService {
  constructor(
    private readonly users: Pick<
      IUserRepository,
      | "listUndatedDeletions"
      | "setKeptUntil"
      | "listErasable"
      | "claimErasure"
      | "eraseForGood"
      | "listWithoutDeadline"
      | "startConfirmDeadline"
      | "listDueReminders"
      | "markReminded"
    >,
    private readonly eraser: IUserDataEraser,
    private readonly email: Pick<EmailService, "sendCode">,
    private readonly config: NightlyPassConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly clock: () => number = Date.now,
  ) {}

  async run(budgetMs: number): Promise<NightlyReport> {
    const stopAt = this.clock() + budgetMs;
    const hasTime = (): boolean => this.clock() < stopAt;
    const report: NightlyReport = {
      dated: 0,
      erased: 0,
      eraseFailed: 0,
      deadlines: 0,
      reminders: 0,
    };

    report.dated = await this.dateDeletions(hasTime);
    await this.erase(hasTime, report);
    if (this.config.deadlines) await this.sendDeadlines(hasTime, report);

    logger.info({ code: "NIGHTLY_PASS_DONE", ...report }, "Nightly pass done");
    return report;
  }

  private async dateDeletions(hasTime: () => boolean): Promise<number> {
    let dated = 0;
    while (hasTime()) {
      const batch = await this.users.listUndatedDeletions(BATCH);
      if (batch.length === 0) break;
      for (const user of batch) {
        await this.users.setKeptUntil(
          user.id,
          keptUntilFrom(this.now(), user.timezone),
        );
        dated += 1;
      }
    }
    return dated;
  }

  private async erase(
    hasTime: () => boolean,
    report: NightlyReport,
  ): Promise<void> {
    const failed: string[] = [];
    while (hasTime()) {
      const ids = await this.users.listErasable(this.now(), BATCH, failed);
      if (ids.length === 0) return;
      for (const id of ids) {
        if (!hasTime()) break;
        try {
          if (await this.users.claimErasure(id, this.now())) {
            await this.eraser.eraseAccount(id);
            await this.users.eraseForGood(id);
            report.erased += 1;
          }
        } catch (err) {
          failed.push(id);
          report.eraseFailed += 1;
          logger.error(
            { err, code: "ACCOUNT_ERASE_FAILED", userId: id },
            "A deleted account past its 30 days could not be erased: the next pass tries again",
          );
        }
      }
    }
    const left = await this.users.listErasable(this.now(), 1, failed);
    if (left.length > 0) {
      logger.error(
        { code: "ACCOUNT_ERASE_BACKLOG", erased: report.erased },
        "The nightly pass ran out of time with accounts still to erase",
      );
    }
  }

  private async sendDeadlines(
    hasTime: () => boolean,
    report: NightlyReport,
  ): Promise<void> {
    let budget = this.config.deadlineEmailsPerNight;
    const skipped: string[] = [];

    while (hasTime() && budget > 0) {
      const batch = await this.users.listDueReminders(
        this.now(),
        new Date(this.now().getTime() + (CONFIRM_REMINDER_DAYS + 1) * DAY_MS),
        BATCH,
        skipped,
      );
      const due = batch.filter((user) => this.remindable(user));
      skipped.push(
        ...batch.filter((user) => !due.includes(user)).map((u) => u.id),
      );
      if (batch.length === 0) break;
      for (const user of due) {
        if (!hasTime() || budget <= 0) return;
        const sending = await this.remind(user, skipped, report);
        if (sending === "stop") return;
        if (sending === "sent") budget -= 1;
      }
    }

    while (hasTime() && budget > 0) {
      const batch = await this.users.listWithoutDeadline(BATCH, skipped);
      if (batch.length === 0) return;
      for (const user of batch) {
        if (!hasTime() || budget <= 0) return;
        const sending = await this.announce(user, skipped, report);
        if (sending === "stop") return;
        if (sending === "sent") budget -= 1;
      }
    }
  }

  private remindable(user: User): boolean {
    const deadline = user.confirmDeadline;
    return (
      !!deadline &&
      daysUntil(deadline.day, this.now(), user.timezone) <=
        CONFIRM_REMINDER_DAYS
    );
  }

  private async announce(
    user: User,
    skipped: string[],
    report: NightlyReport,
  ): Promise<Sending> {
    const token = newAccountLinkToken(user.id);
    const { day, endsAt } = dayAfter(
      this.now(),
      CONFIRM_DEADLINE_DAYS,
      user.timezone,
    );
    const outcome = await this.email.sendCode({
      template: "confirm-deadline",
      data: { token, deadline: day },
      recipient: this.recipient(user),
      requester: null,
    });
    skipped.push(user.id);
    if (!mayHaveArrived(outcome)) return this.skip(outcome);
    if (
      await this.users.startConfirmDeadline(user.id, user.email, {
        day,
        endsAt,
        remindedAt: null,
        links: [{ email: user.email, tokenHash: tokenDigest(token) }],
      })
    ) {
      report.deadlines += 1;
    }
    return "sent";
  }

  private async remind(
    user: User,
    skipped: string[],
    report: NightlyReport,
  ): Promise<Sending> {
    const deadline = user.confirmDeadline;
    skipped.push(user.id);
    if (!deadline) return "skipped";
    const token = newAccountLinkToken(user.id);
    const outcome = await this.email.sendCode({
      template: "confirm-deadline-reminder",
      data: {
        token,
        deadline: deadline.day,
        daysLeft: Math.max(
          1,
          daysUntil(deadline.day, this.now(), user.timezone),
        ),
      },
      recipient: this.recipient(user),
      requester: null,
    });
    if (!mayHaveArrived(outcome)) return this.skip(outcome);
    if (
      await this.users.markReminded(
        user.id,
        { email: user.email, tokenHash: tokenDigest(token) },
        this.now(),
      )
    ) {
      report.reminders += 1;
    }
    return "sent";
  }

  // An address that refuses mail is skipped tonight; a cap, a switch or an outage stops every send until the next pass.
  private skip(outcome: EmailOutcome): Sending {
    return outcome.status === "failed" && outcome.reason === "rejected"
      ? "skipped"
      : "stop";
  }

  private recipient(user: User): {
    userId: string;
    email: string;
    locale: User["locale"];
    timezone: string;
  } {
    return {
      userId: user.id,
      email: user.email,
      locale: user.locale,
      timezone: user.timezone,
    };
  }
}
