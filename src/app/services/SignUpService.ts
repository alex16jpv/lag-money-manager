import bcryptjs from "bcryptjs";
import { v7 as uuidv7 } from "uuid";

import { User } from "../../domain/entities/User";
import {
  AuthCodeRecord,
  IAuthCodeRepository,
} from "../../domain/repositories/authCode/IAuthCodeRepository";
import {
  ISignUpRepository,
  PendingSignUp,
} from "../../domain/repositories/signUp/ISignUpRepository";
import {
  AddressHolder,
  IUserRepository,
} from "../../domain/repositories/user/IUserRepository";
import { ENVIRONMENT } from "../../shared/constants";
import { lastDayKeyOf } from "../../shared/dayKey";
import { hashEmailAddress } from "../../shared/emailHash";
import { ApiError } from "../../shared/errors";
import { DEFAULT_LOCALE } from "../../shared/locale";
import logger from "../../shared/logger";
import { DEFAULT_TIMEZONE } from "../../shared/timezone";
import {
  CreateUserDTO,
  toUserResponse,
  UserResponseDTO,
} from "../dtos/UserDTO";
import { AccountExists } from "../email/templates";
import {
  CODE_MAX_ATTEMPTS,
  codeDigest,
  newCode,
  newLinkToken,
  signUpCodeKey,
  tokenDigest,
  VERIFY_CODE_LIFETIME_MS,
} from "./authCodes";
import { AuthService, OpenedSession } from "./AuthService";
import { datedDeletion, deletedDays } from "./deletedAccount";
import { EmailRequester, EmailService } from "./EmailService";

export const SIGN_UP_LIFETIME_MS = VERIFY_CODE_LIFETIME_MS;

export interface SignUpConfig {
  resendAfterSeconds: number;
  // Covers the MongoDB round trips of a send on top of the providers' own ceiling.
  floorMarginMs: number;
}

export type SignUpAnswer =
  | {
      status: "accepted";
      resendAfterSeconds: number;
    }
  | { status: "limited"; retryAfterSeconds: number };

export type SignUpStarted =
  | (Extract<SignUpAnswer, { status: "accepted" }> & {
      signUpToken: string;
      expiresAt: Date;
    })
  | Extract<SignUpAnswer, { status: "limited" }>;

const codeInvalid = (): ApiError =>
  new ApiError(
    "BadRequest",
    "That code doesn't work: it may be mistyped, out of date or replaced by a newer one",
    "SIGN_UP_CODE_INVALID",
  );

const expired = (): ApiError =>
  new ApiError(
    "Conflict",
    "This sign-up is over: its 24 hours passed or a newer one replaced it. Start again",
    "SIGN_UP_EXPIRED",
  );

const linkInvalid = (): ApiError =>
  new ApiError("BadRequest", "This link no longer works", "LINK_INVALID");

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class SignUpService {
  constructor(
    private readonly users: Pick<
      IUserRepository,
      "holderOf" | "getByIdWithPassword" | "setKeptUntil"
    >,
    private readonly signUps: ISignUpRepository,
    private readonly codes: Pick<
      IAuthCodeRepository,
      "recordRequest" | "issue" | "countAttempt"
    >,
    private readonly email: Pick<
      EmailService,
      "holdBrakes" | "sendCode" | "providerCeilingMs"
    >,
    private readonly auth: Pick<AuthService, "createAccount" | "openSession">,
    private readonly config: SignUpConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  async start(
    dto: CreateUserDTO,
    requester: EmailRequester,
  ): Promise<SignUpStarted> {
    const held = await this.email.holdBrakes({
      template: "sign-up",
      email: dto.email,
      requester,
    });
    if (held.limited) {
      return { status: "limited", retryAfterSeconds: held.retryAfterSeconds };
    }

    const startedAt = Date.now();
    const signUpToken = newLinkToken();
    const expiresAt = new Date(this.now().getTime() + SIGN_UP_LIFETIME_MS);
    const pending: PendingSignUp = {
      id: tokenDigest(signUpToken),
      toHash: hashEmailAddress(dto.email),
      email: dto.email,
      name: dto.name,
      passwordHash: await bcryptjs.hash(
        dto.password,
        ENVIRONMENT.BCRYPT_SALT_ROUNDS,
      ),
      timezone: dto.timezone,
      currency: dto.currency,
      locale: dto.locale,
      userId: null,
      signedInAt: null,
      expiresAt,
    };
    await this.signUps.replace(pending);
    await this.sendQuietly(pending, requester);
    await this.holdFloor(startedAt);
    return {
      status: "accepted",
      resendAfterSeconds: this.config.resendAfterSeconds,
      signUpToken,
      expiresAt,
    };
  }

  async resend(
    signUpToken: string,
    requester: EmailRequester,
  ): Promise<SignUpAnswer> {
    const pending = await this.signUps.findLive(
      tokenDigest(signUpToken),
      this.now(),
    );
    if (!pending) throw expired();
    const held = await this.email.holdBrakes({
      template: "sign-up",
      email: pending.email,
      requester,
    });
    if (held.limited) {
      return { status: "limited", retryAfterSeconds: held.retryAfterSeconds };
    }
    const startedAt = Date.now();
    await this.sendQuietly(pending, requester);
    await this.holdFloor(startedAt);
    return {
      status: "accepted",
      resendAfterSeconds: this.config.resendAfterSeconds,
    };
  }

  // Only the browser that holds the sign-up, where the password was typed, gets a session, and only once.
  async confirmCode(
    signUpToken: string,
    code: string,
    userAgent?: string,
  ): Promise<OpenedSession & { user: UserResponseDTO }> {
    const now = this.now();
    const pending = await this.signUps.findLive(tokenDigest(signUpToken), now);
    if (!pending) throw codeInvalid();
    const key = signUpCodeKey(pending.id);
    const counted = await this.codes.countAttempt(
      "sign-up",
      key,
      CODE_MAX_ATTEMPTS,
    );
    const mine = counted?.userId === pending.id ? counted : null;
    const digest = codeDigest(key, code);
    if (!mine?.codes.some((c) => c.expiresAt > now && c.codeHash === digest)) {
      throw codeInvalid();
    }
    const user = await this.account(pending, codeInvalid);
    if (!(await this.signUps.markSignedIn(pending.id, now))) {
      throw codeInvalid();
    }
    const session = await this.auth.openSession(user, userAgent);
    return { ...session, user: toUserResponse(user, now) };
  }

  // The email's button: proves the inbox, not the password, so it creates the account and signs nobody in.
  async confirmLink(record: AuthCodeRecord): Promise<void> {
    const pending = record.userId
      ? await this.signUps.findLive(record.userId, this.now())
      : null;
    if (!pending || signUpCodeKey(pending.id) !== record.toHash) {
      throw linkInvalid();
    }
    await this.account(pending, linkInvalid);
  }

  // Confirming twice changes nothing: the second finds the account the first created.
  private async account(
    pending: PendingSignUp,
    gone: () => ApiError,
  ): Promise<User> {
    if (pending.userId) return this.created(pending, gone);
    const userId = uuidv7();
    const claimed = await this.signUps.claimCreation(
      pending.id,
      userId,
      this.now(),
    );
    if (!claimed) {
      const current = await this.signUps.findLive(pending.id, this.now());
      if (!current?.userId) throw gone();
      return this.created(current, gone);
    }
    try {
      return await this.auth.createAccount({
        id: userId,
        name: pending.name,
        email: pending.email,
        passwordHash: pending.passwordHash,
        timezone: pending.timezone,
        currency: pending.currency,
        locale: pending.locale,
        emailVerifiedAt: this.now(),
      });
    } catch (err) {
      await this.signUps.releaseCreation(pending.id, userId);
      throw err;
    }
  }

  private async created(
    pending: PendingSignUp,
    gone: () => ApiError,
  ): Promise<User> {
    const user = pending.userId
      ? await this.users.getByIdWithPassword(pending.userId)
      : null;
    // A password changed since then means the code no longer stands for whoever holds the account.
    if (!user || user.password !== pending.passwordHash) throw gone();
    return user;
  }

  // Never shown: only the branch with no account could fail differently, so a failure would tell which branch ran.
  private async sendQuietly(
    pending: PendingSignUp,
    requester: EmailRequester,
  ): Promise<void> {
    try {
      await this.send(pending, requester);
    } catch (err) {
      logger.error(
        { err, code: "SIGN_UP_EMAIL_NOT_SENT" },
        "A sign-up email failed after its brakes: nothing tells the requester",
      );
    }
  }

  private async send(
    pending: PendingSignUp,
    requester: EmailRequester,
  ): Promise<void> {
    const now = this.now();
    const holder = await this.users.holderOf(pending.email, now);
    if (holder) {
      await this.email.sendCode({
        template: "account-exists",
        data: await this.existing(holder, now),
        recipient: {
          userId: holder.user.id,
          email: pending.email,
          locale: holder.user.locale,
          timezone: holder.user.timezone,
        },
        requester,
        brakesHeld: true,
      });
      return;
    }

    const code = newCode();
    const token = newLinkToken();
    const outcome = await this.email.sendCode({
      template: "sign-up",
      data: { code, token },
      recipient: {
        userId: pending.id,
        email: pending.email,
        locale: pending.locale ?? DEFAULT_LOCALE,
        timezone: pending.timezone ?? DEFAULT_TIMEZONE,
      },
      requester,
      brakesHeld: true,
    });
    const unconfirmed =
      outcome.status === "failed" && outcome.reason === "unconfirmed";
    if (outcome.status !== "sent" && !unconfirmed) return;
    const key = signUpCodeKey(pending.id);
    await this.codes.recordRequest(
      "sign-up",
      key,
      pending.id,
      pending.expiresAt,
    );
    await this.codes.issue(
      "sign-up",
      key,
      {
        codeHash: codeDigest(key, code),
        tokenHash: tokenDigest(token),
        expiresAt: new Date(now.getTime() + VERIFY_CODE_LIFETIME_MS),
      },
      unconfirmed,
      now,
    );
  }

  private async existing(
    holder: AddressHolder,
    now: Date,
  ): Promise<AccountExists> {
    if (holder.state === "deleted") {
      return {
        state: "deleted",
        ...deletedDays(await datedDeletion(this.users, holder.user, now)),
      };
    }
    if (holder.state === "held") {
      return {
        state: "held",
        freeOn: lastDayKeyOf(holder.freeAt, holder.user.timezone),
      };
    }
    return { state: "live" };
  }

  private async holdFloor(startedAt: number): Promise<void> {
    const floor = this.email.providerCeilingMs + this.config.floorMarginMs;
    const elapsed = Date.now() - startedAt;
    if (elapsed < floor) await this.wait(floor - elapsed);
  }
}
