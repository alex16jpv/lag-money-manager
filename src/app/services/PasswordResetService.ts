import bcryptjs from "bcryptjs";

import { User } from "../../domain/entities/User";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import {
  AuthCodeRecord,
  IAuthCodeRepository,
} from "../../domain/repositories/authCode/IAuthCodeRepository";
import { IRefreshSessionRepository } from "../../domain/repositories/refreshSession/IRefreshSessionRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { AuthCodePurpose, ENVIRONMENT } from "../../shared/constants";
import { hashEmailAddress } from "../../shared/emailHash";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";
import { toUserResponse, UserResponseDTO } from "../dtos/UserDTO";
import {
  CODE_MAX_ATTEMPTS,
  codeDigest,
  newCode,
  newLinkToken,
  RESET_CODE_LIFETIME_MS,
  tokenDigest,
} from "./authCodes";
import { AuthService, OpenedSession } from "./AuthService";
import { EmailRequester, EmailService } from "./EmailService";

const PURPOSE: AuthCodePurpose = "reset";

export type ForgotOutcome =
  | { status: "accepted"; resendAfterSeconds: number }
  | { status: "limited"; retryAfterSeconds: number };

export type ResetProof = { email: string; code: string } | { token: string };

// The MongoDB round trips of a send (suppression read, caps, delivery row, the code) fit well inside it.
export const FORGOT_FLOOR_MARGIN_MS = 500;

export interface PasswordResetConfig {
  resendAfterSeconds: number;
  // Covers the MongoDB round trips of a send on top of the providers' own ceiling.
  floorMarginMs: number;
}

const codeInvalid = (): ApiError =>
  new ApiError(
    "BadRequest",
    "That code doesn't work: it may be mistyped, out of date or replaced by a newer one",
    "RESET_CODE_INVALID",
  );

const linkInvalid = (): ApiError =>
  new ApiError("BadRequest", "This link no longer works", "LINK_INVALID");

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class PasswordResetService {
  constructor(
    private readonly users: IUserRepository,
    private readonly codes: IAuthCodeRepository,
    private readonly email: Pick<
      EmailService,
      "holdBrakes" | "sendCode" | "providerCeilingMs"
    >,
    private readonly accounts: Pick<IAccountRepository, "countByUserId">,
    private readonly transactions: Pick<
      ITransactionRepository,
      "countByUserId"
    >,
    private readonly sessions: Pick<
      IRefreshSessionRepository,
      "revokeAllForUser"
    >,
    private readonly auth: Pick<AuthService, "openSession">,
    private readonly config: PasswordResetConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  // The same answer, in at least the same time, whether the address has a live account, a deleted one or none.
  async forgot(
    email: string,
    requester: EmailRequester,
  ): Promise<ForgotOutcome> {
    const held = await this.email.holdBrakes({
      template: "password-reset",
      email,
      requester,
    });
    if (held.limited) {
      return { status: "limited", retryAfterSeconds: held.retryAfterSeconds };
    }

    const startedAt = Date.now();
    const toHash = hashEmailAddress(email);
    try {
      const user = await this.users.getByEmail(email);
      await this.codes.recordRequest(
        PURPOSE,
        toHash,
        user?.id ?? null,
        new Date(this.now().getTime() + RESET_CODE_LIFETIME_MS),
      );
      if (user) await this.sendCode(user, toHash, requester);
    } catch (err) {
      // Only an address with an account can fail past this point, so the answer cannot say it did.
      logger.error(
        { err, code: "PASSWORD_RESET_NOT_SENT" },
        "A password reset request failed after its brakes: nothing tells the requester",
      );
    }

    const floor = this.email.providerCeilingMs + this.config.floorMarginMs;
    const elapsed = Date.now() - startedAt;
    if (elapsed < floor) await this.wait(floor - elapsed);
    return {
      status: "accepted",
      resendAfterSeconds: this.config.resendAfterSeconds,
    };
  }

  private async sendCode(
    user: User,
    toHash: string,
    requester: EmailRequester,
  ): Promise<void> {
    const code = newCode();
    const token = newLinkToken();
    const outcome = await this.email.sendCode({
      template: "password-reset",
      data: { code, token },
      recipient: {
        userId: user.id,
        email: user.email,
        locale: user.locale,
        timezone: user.timezone,
      },
      requester,
      brakesHeld: true,
    });
    const unconfirmed =
      outcome.status === "failed" && outcome.reason === "unconfirmed";
    // A send that failed leaves the person with the code they already had.
    if (outcome.status !== "sent" && !unconfirmed) return;
    await this.codes.issue(
      PURPOSE,
      toHash,
      {
        codeHash: codeDigest(toHash, code),
        tokenHash: tokenDigest(token),
        expiresAt: new Date(this.now().getTime() + RESET_CODE_LIFETIME_MS),
      },
      unconfirmed,
      this.now(),
    );
  }

  async reset(
    proof: ResetProof,
    newPassword: string,
    userAgent?: string,
  ): Promise<OpenedSession & { user: UserResponseDTO }> {
    const byToken = "token" in proof;
    const refused = byToken ? linkInvalid : codeInvalid;
    // Hashed first, so every answer, right or wrong, pays the same bcrypt time.
    const passwordHash = await bcryptjs.hash(
      newPassword,
      ENVIRONMENT.BCRYPT_SALT_ROUNDS,
    );

    const record = await this.redeem(proof);
    if (!record?.userId) throw refused();
    const user = await this.users.getById(record.userId);
    // The code was for the address the account had: one that moved to another address no longer opens it.
    if (!user || hashEmailAddress(user.email) !== record.toHash) {
      throw refused();
    }

    const question = user.emailVerifiedAt ? null : await this.contents(user.id);
    const updated = await this.users.resetPassword(
      user.id,
      passwordHash,
      question,
      this.now(),
    );
    if (!updated) throw refused();
    await this.sessions.revokeAllForUser(updated.id);
    const session = await this.auth.openSession(updated, userAgent);
    return { ...session, user: toUserResponse(updated) };
  }

  private async redeem(proof: ResetProof): Promise<AuthCodeRecord | null> {
    const now = this.now();
    if ("token" in proof) {
      return this.codes.redeemToken(PURPOSE, tokenDigest(proof.token), now);
    }
    const toHash = hashEmailAddress(proof.email);
    const counted = await this.codes.countAttempt(
      PURPOSE,
      toHash,
      CODE_MAX_ATTEMPTS,
    );
    if (!counted) return null;
    return this.codes.redeemCode(
      counted.id,
      codeDigest(toHash, proof.code),
      now,
    );
  }

  // An account with nothing in it has nothing to keep, so the question is not asked.
  private async contents(
    userId: string,
  ): Promise<{ accounts: number; transactions: number } | null> {
    const [accounts, transactions] = await Promise.all([
      this.accounts.countByUserId(userId),
      this.transactions.countByUserId(userId),
    ]);
    return accounts + transactions > 0 ? { accounts, transactions } : null;
  }
}
