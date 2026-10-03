import bcryptjs from "bcryptjs";

import {
  AuthCodeRecord,
  IAuthCodeRepository,
} from "../../domain/repositories/authCode/IAuthCodeRepository";
import { IRefreshSessionRepository } from "../../domain/repositories/refreshSession/IRefreshSessionRepository";
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { AuthCodePurpose, ENVIRONMENT } from "../../shared/constants";
import { dayKeyOf } from "../../shared/dayKey";
import { hashEmailAddress } from "../../shared/emailHash";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";
import { toUserResponse, UserResponseDTO } from "../dtos/UserDTO";
import {
  CODE_MAX_ATTEMPTS,
  codeDigest,
  emailChangeKey,
  RESET_CODE_LIFETIME_MS,
  tokenDigest,
} from "./authCodes";
import { AuthService, OpenedSession } from "./AuthService";
import { datedDeletion, deletedDays } from "./deletedAccount";
import { EmailRequester, EmailService } from "./EmailService";
import { sendResetCode } from "./resetCode";
import { sendSecurityNotice } from "./securityNotice";

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
      "holdBrakes" | "sendCode" | "sendNotice" | "providerCeilingMs"
    >,
    private readonly sessions: Pick<
      IRefreshSessionRepository,
      "revokeAllForUser"
    >,
    private readonly invitations: Pick<
      ISharedInvitationRepository,
      "touchUnansweredFor"
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
      const now = this.now();
      const user = await this.users.getReachableByEmail(email, now);
      await this.codes.recordRequest(
        PURPOSE,
        toHash,
        user?.id ?? null,
        new Date(now.getTime() + RESET_CODE_LIFETIME_MS),
      );
      if (user) {
        await sendResetCode(
          { codes: this.codes, email: this.email, now: this.now },
          user,
          "password-reset",
          user.deletedAt
            ? {
                deleted: deletedDays(
                  await datedDeletion(this.users, user, now),
                ),
              }
            : {},
          requester,
          true,
        );
      }
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

  async reset(
    proof: ResetProof,
    newPassword: string,
    userAgent?: string,
  ): Promise<OpenedSession & { user: UserResponseDTO; restored: boolean }> {
    const byToken = "token" in proof;
    const refused = byToken ? linkInvalid : codeInvalid;
    // Hashed first, so every answer, right or wrong, pays the same bcrypt time.
    const passwordHash = await bcryptjs.hash(
      newPassword,
      ENVIRONMENT.BCRYPT_SALT_ROUNDS,
    );

    const record = await this.redeem(proof);
    if (!record?.userId) throw refused();
    const user = await this.users.getForUndo(record.userId);
    // The code was for the address the account had: one that moved to another address no longer opens it.
    if (!user || hashEmailAddress(user.email) !== record.toHash) {
      throw refused();
    }

    const now = this.now();
    const updated = await this.users.resetPassword(user.id, passwordHash, now);
    if (!updated) throw refused();
    await this.sessions.revokeAllForUser(updated.id);
    if (user.emailChange) {
      await this.codes.discard(
        "email-change",
        emailChangeKey(user.id, user.emailChange.email),
      );
    }
    if (!user.emailVerifiedAt) {
      await this.invitations.touchUnansweredFor(updated.email, this.now());
    }
    const session = await this.auth.openSession(updated, userAgent);
    if (user.deletedAt) {
      await sendSecurityNotice(this.email, updated, "account-restored", {
        at: now,
        userAgent,
        deletedOn: dayKeyOf(user.deletedAt, user.timezone),
        by: "reset",
      });
    } else {
      await sendSecurityNotice(this.email, updated, "password-changed", {
        at: now,
        userAgent,
      });
    }
    return {
      ...session,
      user: toUserResponse(updated, now),
      restored: user.deletedAt !== null,
    };
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
}
