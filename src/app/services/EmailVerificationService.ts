import { User } from "../../domain/entities/User";
import { IAuthCodeRepository } from "../../domain/repositories/authCode/IAuthCodeRepository";
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { AuthCodePurpose } from "../../shared/constants";
import { hashEmailAddress } from "../../shared/emailHash";
import { ApiError } from "../../shared/errors";
import { EmailVerificationView } from "../dtos/UserDTO";
import {
  accountLinkOwner,
  CODE_MAX_ATTEMPTS,
  codeDigest,
  newCode,
  newLinkToken,
  tokenDigest,
  VERIFY_CODE_LIFETIME_MS,
} from "./authCodes";
import { EmailOutcome, EmailRequester, EmailService } from "./EmailService";
import { SignUpService } from "./SignUpService";

const PURPOSE: AuthCodePurpose = "verify";

export type VerificationRecipient = Pick<
  User,
  "id" | "email" | "locale" | "timezone"
>;

// /verify finishes a sign-up without a session, or confirms an account from before email existed.
export type VerifiedByLink = "account-ready" | "email-confirmed";

export interface EmailVerificationConfig {
  // The per-address interval of the email brakes: when Resend can go again.
  resendAfterSeconds: number;
}

const notFound = (): ApiError => new ApiError("NotFound", "User not found");

const codeInvalid = (): ApiError =>
  new ApiError(
    "BadRequest",
    "That code isn't right: check the last email we sent",
    "EMAIL_CODE_INVALID",
  );

const codeExpired = (): ApiError =>
  new ApiError(
    "BadRequest",
    "This code no longer works: it expired or was tried too many times. Send a new one",
    "EMAIL_CODE_EXPIRED",
  );

const linkInvalid = (): ApiError =>
  new ApiError("BadRequest", "This link no longer works", "LINK_INVALID");

export class EmailVerificationService {
  constructor(
    private readonly users: IUserRepository,
    private readonly codes: IAuthCodeRepository,
    private readonly email: Pick<EmailService, "sendCode">,
    private readonly invitations: Pick<
      ISharedInvitationRepository,
      "touchUnansweredFor"
    >,
    private readonly signUps: Pick<SignUpService, "confirmLink">,
    private readonly config: EmailVerificationConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(
    recipient: VerificationRecipient,
    requester: EmailRequester,
  ): Promise<EmailOutcome> {
    const toHash = hashEmailAddress(recipient.email);
    const code = newCode();
    const token = newLinkToken();
    const outcome = await this.email.sendCode({
      template: "verify-email",
      data: { code, token },
      recipient: {
        userId: recipient.id,
        email: recipient.email,
        locale: recipient.locale,
        timezone: recipient.timezone,
      },
      requester,
    });
    const unconfirmed =
      outcome.status === "failed" && outcome.reason === "unconfirmed";
    if (outcome.status !== "sent" && !unconfirmed) return outcome;

    const now = this.now();
    const expiresAt = new Date(now.getTime() + VERIFY_CODE_LIFETIME_MS);
    await this.codes.recordRequest(PURPOSE, toHash, recipient.id, expiresAt);
    await this.codes.issue(
      PURPOSE,
      toHash,
      {
        codeHash: codeDigest(toHash, code),
        tokenHash: tokenDigest(token),
        expiresAt,
      },
      unconfirmed,
      now,
    );
    return outcome;
  }

  async resend(
    userId: string,
    requester: EmailRequester,
  ): Promise<EmailOutcome> {
    const user = await this.users.getById(userId);
    if (!user) throw notFound();
    if (user.emailVerifiedAt) {
      throw new ApiError(
        "Conflict",
        "This email is already confirmed",
        "EMAIL_ALREADY_VERIFIED",
      );
    }
    return this.send(user, requester);
  }

  async status(user: User): Promise<EmailVerificationView | null> {
    if (user.emailVerifiedAt) return null;
    const found = await this.codes.find(PURPOSE, hashEmailAddress(user.email));
    const row = found?.userId === user.id ? found : null;
    const now = this.now();
    const lastSentAt = row?.issuedAt ?? null;
    const resendAt = lastSentAt
      ? new Date(lastSentAt.getTime() + this.config.resendAfterSeconds * 1000)
      : null;
    return {
      codeLive:
        !!row &&
        row.attempts < CODE_MAX_ATTEMPTS &&
        row.codes.some((c) => c.expiresAt > now),
      lastSentAt,
      resendAvailableAt: resendAt && resendAt > now ? resendAt : null,
    };
  }

  async verifyCode(userId: string, code: string): Promise<void> {
    const user = await this.users.getById(userId);
    if (!user) throw notFound();
    if (user.emailVerifiedAt) return;
    const toHash = hashEmailAddress(user.email);
    const counted = await this.codes.countAttempt(
      PURPOSE,
      toHash,
      CODE_MAX_ATTEMPTS,
    );
    const now = this.now();
    const mine = counted?.userId === user.id ? counted : null;
    const live = mine?.codes.filter((c) => c.expiresAt > now) ?? [];
    if (live.length === 0) throw codeExpired();
    const digest = codeDigest(toHash, code);
    if (!live.some((c) => c.codeHash === digest)) throw codeInvalid();
    if (!(await this.confirm(user))) throw codeInvalid();
  }

  async verifyLink(token: string): Promise<VerifiedByLink> {
    const owner = accountLinkOwner(token);
    if (owner) {
      await this.verifyDeadlineLink(owner, token);
      return "email-confirmed";
    }
    const now = this.now();
    const digest = tokenDigest(token);
    const signUp = await this.codes.findByLiveToken("sign-up", digest, now);
    if (signUp) {
      await this.signUps.confirmLink(signUp);
      return "account-ready";
    }
    const record = await this.codes.findByLiveToken(PURPOSE, digest, now);
    if (!record?.userId) throw linkInvalid();
    const user = await this.users.getById(record.userId);
    if (!user || hashEmailAddress(user.email) !== record.toHash) {
      throw linkInvalid();
    }
    if (user.emailVerifiedAt) return "email-confirmed";
    if (!(await this.confirm(user))) throw linkInvalid();
    return "email-confirmed";
  }

  // The link of confirm-deadline or its reminder: until the deadline, for the address it went to.
  private async verifyDeadlineLink(
    userId: string,
    token: string,
  ): Promise<void> {
    const user = await this.users.getById(userId);
    const deadline = user?.confirmDeadline;
    const digest = tokenDigest(token);
    const link = deadline?.links.find((l) => l.tokenHash === digest);
    if (
      !user ||
      !deadline ||
      !link ||
      link.email !== user.email ||
      this.now() >= deadline.endsAt
    ) {
      throw linkInvalid();
    }
    if (user.emailVerifiedAt) return;
    if (!(await this.confirm(user))) throw linkInvalid();
  }

  private async confirm(user: User): Promise<User | null> {
    const now = this.now();
    const updated = await this.users.markEmailVerified(
      user.id,
      user.email,
      now,
    );
    if (updated) await this.invitations.touchUnansweredFor(updated.email, now);
    return updated;
  }
}
