import bcryptjs from "bcryptjs";

import { PendingEmailChange, UndoLink, User } from "../../domain/entities/User";
import { IAuthCodeRepository } from "../../domain/repositories/authCode/IAuthCodeRepository";
import { IRefreshSessionRepository } from "../../domain/repositories/refreshSession/IRefreshSessionRepository";
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { AuthCodePurpose, ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import {
  EmailChangeView,
  toUserResponse,
  UserResponseDTO,
} from "../dtos/UserDTO";
import {
  accountLinkOwner,
  CODE_MAX_ATTEMPTS,
  codeDigest,
  emailChangeKey,
  newAccountLinkToken,
  newCode,
  newLinkToken,
  tokenDigest,
  UNDO_LINK_LIFETIME_MS,
  VERIFY_CODE_LIFETIME_MS,
} from "./authCodes";
import { AuthService, OpenedSession } from "./AuthService";
import { assertCurrentPassword } from "./currentPassword";
import { EmailOutcome, EmailRequester, EmailService } from "./EmailService";
import { sendResetAfterLink } from "./resetCode";
import { mayHaveArrived, sendSecurityNotice } from "./securityNotice";

const PURPOSE: AuthCodePurpose = "email-change";

export interface EmailChangeConfig {
  resendAfterSeconds: number;
}

export type EmailChangeRequest =
  | { status: "sent"; emailChange: EmailChangeView }
  | Exclude<EmailOutcome, { status: "sent" }>;

export type EmailChangeConfirmed = {
  user: UserResponseDTO;
} & Partial<OpenedSession>;

export interface EmailChangeUndone {
  email: string;
  codeSent: boolean;
}

const notFound = (): ApiError => new ApiError("NotFound", "User not found");

const notPending = (): ApiError =>
  new ApiError(
    "Conflict",
    "No new email is waiting to be confirmed: it was confirmed, cancelled, replaced or its 24 hours passed",
    "EMAIL_CHANGE_NOT_PENDING",
  );

const emailTaken = (): ApiError =>
  new ApiError(
    "Conflict",
    "That address belongs to another account",
    "EMAIL_TAKEN",
  );

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

export class EmailChangeService {
  constructor(
    private readonly users: IUserRepository,
    private readonly codes: IAuthCodeRepository,
    private readonly email: Pick<EmailService, "sendCode" | "sendNotice">,
    private readonly invitations: Pick<
      ISharedInvitationRepository,
      "touchUnansweredFor"
    >,
    private readonly sessions: Pick<
      IRefreshSessionRepository,
      "revokeAllForUser"
    >,
    private readonly auth: Pick<AuthService, "openSession" | "isLiveSessionOf">,
    private readonly config: EmailChangeConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  view(user: User): EmailChangeView | null {
    const pending = this.pending(user);
    return pending ? this.viewOf(pending) : null;
  }

  private viewOf(pending: PendingEmailChange): EmailChangeView {
    const resendAt = new Date(
      pending.sentAt.getTime() + this.config.resendAfterSeconds * 1000,
    );
    return {
      email: pending.email,
      expiresAt: pending.expiresAt,
      resendAvailableAt: resendAt > this.now() ? resendAt : null,
    };
  }

  async request(
    userId: string,
    email: string,
    currentPassword: string,
    requester: EmailRequester,
    userAgent?: string,
  ): Promise<EmailChangeRequest> {
    const user = await this.users.getByIdWithPassword(userId);
    if (!user) throw notFound();
    await assertCurrentPassword(user, currentPassword);
    if (email === user.email) {
      throw new ApiError("BadRequest", "Validation failed", "VALIDATION", [
        { field: "email", message: "This is already the account's email" },
      ]);
    }
    const outcome = await this.send(user, email, requester);
    if (outcome.status !== "sent") return outcome.result;
    const untold = await this.tellOldAddress(user, email, userAgent);
    if (untold) return untold;
    const saved = await this.users.startEmailChange(user.id, outcome.change);
    if (!saved) throw notFound();
    const replaced = user.emailChange;
    if (replaced && replaced.email !== email) {
      await this.codes.discard(
        PURPOSE,
        emailChangeKey(user.id, replaced.email),
      );
    }
    return { status: "sent", emailChange: this.viewOf(outcome.change) };
  }

  // A refusal when the old address could not be told: the change is then not saved.
  private async tellOldAddress(
    user: User,
    newEmail: string,
    userAgent: string | undefined,
  ): Promise<Exclude<EmailOutcome, { status: "sent" }> | null> {
    if (!user.emailVerifiedAt) return null;
    const now = this.now();
    const undoToken = newAccountLinkToken(user.id);
    const link: UndoLink = {
      email: user.email,
      tokenHash: tokenDigest(undoToken),
      expiresAt: new Date(now.getTime() + UNDO_LINK_LIFETIME_MS),
    };
    if (!(await this.users.addUndoLink(user.id, link, now))) throw notFound();
    const notice = await sendSecurityNotice(
      this.email,
      user,
      "email-change-requested",
      { at: now, userAgent, newEmail, undoToken },
    );
    if (!notice || notice.status === "sent" || mayHaveArrived(notice)) {
      return null;
    }
    await this.users.dropUndoLink(user.id, link.tokenHash);
    return notice.status === "failed" && notice.reason === "rejected"
      ? null
      : notice;
  }

  async resend(
    userId: string,
    requester: EmailRequester,
  ): Promise<EmailChangeRequest> {
    const user = await this.users.getById(userId);
    if (!user) throw notFound();
    const pending = this.pending(user);
    if (!pending) throw notPending();

    const outcome = await this.send(user, pending.email, requester);
    if (outcome.status !== "sent") return outcome.result;
    const { sentAt, expiresAt } = outcome.change;
    const renewed = await this.users.renewEmailChange(
      user.id,
      pending.email,
      sentAt,
      expiresAt,
    );
    if (!renewed) throw notPending();
    return { status: "sent", emailChange: this.viewOf(outcome.change) };
  }

  async cancel(userId: string): Promise<void> {
    const user = await this.users.getById(userId);
    if (!user) throw notFound();
    await this.users.dropEmailChange(user.id);
    if (user.emailChange) {
      await this.codes.discard(
        PURPOSE,
        emailChangeKey(user.id, user.emailChange.email),
      );
    }
  }

  async confirmCode(
    userId: string,
    code: string,
    userAgent?: string,
  ): Promise<{ user: UserResponseDTO } & OpenedSession> {
    const user = await this.users.getById(userId);
    if (!user) throw notFound();
    const pending = this.pending(user);
    if (!pending) throw notPending();

    const toHash = emailChangeKey(user.id, pending.email);
    const counted = await this.codes.countAttempt(
      PURPOSE,
      toHash,
      CODE_MAX_ATTEMPTS,
    );
    const now = this.now();
    const mine = counted?.userId === user.id ? counted : null;
    if (!mine?.codes.some((c) => c.expiresAt > now)) throw codeExpired();
    const redeemed = await this.codes.redeemCode(
      mine.id,
      codeDigest(toHash, code),
      now,
    );
    if (!redeemed) throw codeInvalid();

    const updated = await this.apply(user, pending.email, notPending);
    const session = await this.auth.openSession(updated, userAgent);
    return { ...session, user: toUserResponse(updated) };
  }

  async confirmLink(
    token: string,
    refreshToken: string | undefined,
    userAgent?: string,
  ): Promise<EmailChangeConfirmed> {
    const record = await this.codes.redeemToken(
      PURPOSE,
      tokenDigest(token),
      this.now(),
    );
    if (!record?.userId) throw linkInvalid();
    const user = await this.users.getById(record.userId);
    const pending = user ? this.pending(user) : null;
    if (
      !user ||
      !pending ||
      emailChangeKey(user.id, pending.email) !== record.toHash
    ) {
      throw linkInvalid();
    }

    // Read before the change: the bump of tokenVersion is what ends that session.
    const keepsSession =
      !!refreshToken && (await this.auth.isLiveSessionOf(refreshToken, user));
    const updated = await this.apply(user, pending.email, linkInvalid);
    if (!keepsSession) return { user: toUserResponse(updated) };
    const session = await this.auth.openSession(updated, userAgent);
    return { ...session, user: toUserResponse(updated) };
  }

  async undo(token: string): Promise<EmailChangeUndone> {
    const userId = accountLinkOwner(token);
    const user = userId ? await this.users.getForUndo(userId) : null;
    const now = this.now();
    const tokenHash = tokenDigest(token);
    const link = user?.undoLinks.find(
      (l) => l.tokenHash === tokenHash && l.expiresAt > now,
    );
    if (!user || !link) throw linkInvalid();

    const unusable = await bcryptjs.hash(
      newLinkToken(),
      ENVIRONMENT.BCRYPT_SALT_ROUNDS,
    );
    const undone = await this.users.undoEmailChange(
      user.id,
      link,
      unusable,
      now,
    );
    if (!undone) throw linkInvalid();
    await this.sessions.revokeAllForUser(undone.id);
    if (user.emailChange) {
      await this.codes.discard(
        PURPOSE,
        emailChangeKey(user.id, user.emailChange.email),
      );
    }
    if (user.email !== undone.email) {
      await this.invitations.touchUnansweredFor(undone.email, now);
    }
    return {
      email: undone.email,
      codeSent: await sendResetAfterLink(
        { codes: this.codes, email: this.email, now: this.now },
        undone,
        false,
      ),
    };
  }

  private async apply(
    user: User,
    email: string,
    gone: () => ApiError,
  ): Promise<User> {
    const now = this.now();
    const applied = await this.users.applyEmailChange(user.id, email, now);
    if (applied === "taken") {
      await this.users.dropEmailChange(user.id, email);
      await this.codes.discard(PURPOSE, emailChangeKey(user.id, email));
      throw emailTaken();
    }
    if (!applied) throw gone();
    await this.sessions.revokeAllForUser(applied.id);
    await this.invitations.touchUnansweredFor(applied.email, now);
    return applied;
  }

  private async send(
    user: User,
    email: string,
    requester: EmailRequester,
  ): Promise<
    | { status: "sent"; change: PendingEmailChange }
    | { status: "refused"; result: Exclude<EmailOutcome, { status: "sent" }> }
  > {
    const toHash = emailChangeKey(user.id, email);
    const code = newCode();
    const token = newLinkToken();
    const recipient = {
      userId: user.id,
      email,
      locale: user.locale,
      timezone: user.timezone,
    };
    // A held address waits like any other, with a code nobody receives: its answers cannot tell it apart.
    const taken = await this.users.holderOf(email, this.now(), user.id);
    const outcome = taken
      ? await this.email.sendCode({
          template: "email-change-taken",
          data: {},
          recipient,
          requester,
        })
      : await this.email.sendCode({
          template: "email-change-confirm",
          data: { code, token, currentEmail: user.email },
          recipient,
          requester,
        });
    const unconfirmed =
      outcome.status === "failed" && outcome.reason === "unconfirmed";
    if (outcome.status !== "sent" && !unconfirmed) {
      return { status: "refused", result: outcome };
    }

    const now = this.now();
    const expiresAt = new Date(now.getTime() + VERIFY_CODE_LIFETIME_MS);
    await this.codes.recordRequest(PURPOSE, toHash, user.id, expiresAt);
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
    return { status: "sent", change: { email, sentAt: now, expiresAt } };
  }

  private pending(user: User): PendingEmailChange | null {
    const pending = user.emailChange;
    return pending && pending.expiresAt > this.now() ? pending : null;
  }
}
