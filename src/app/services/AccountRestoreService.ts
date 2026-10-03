import bcryptjs from "bcryptjs";

import { IAuthCodeRepository } from "../../domain/repositories/authCode/IAuthCodeRepository";
import { IRefreshSessionRepository } from "../../domain/repositories/refreshSession/IRefreshSessionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import {
  accountLinkOwner,
  emailChangeKey,
  newLinkToken,
  tokenDigest,
} from "./authCodes";
import { EmailChangeUndone } from "./EmailChangeService";
import { EmailService } from "./EmailService";
import { sendResetAfterLink } from "./resetCode";

const linkInvalid = (): ApiError =>
  new ApiError("BadRequest", "This link no longer works", "LINK_INVALID");

// "Restore account" in account-deleted is for whoever did not delete it: like /undo, it signs everyone out and stops the password.
export class AccountRestoreService {
  constructor(
    private readonly users: Pick<
      IUserRepository,
      "getForUndo" | "restoreFromLink"
    >,
    private readonly codes: Pick<
      IAuthCodeRepository,
      "recordRequest" | "issue" | "discard"
    >,
    private readonly email: Pick<EmailService, "sendCode">,
    private readonly sessions: Pick<
      IRefreshSessionRepository,
      "revokeAllForUser"
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async restore(token: string): Promise<EmailChangeUndone> {
    const userId = accountLinkOwner(token);
    const user = userId ? await this.users.getForUndo(userId) : null;
    const now = this.now();
    const tokenHash = tokenDigest(token);
    if (
      !user?.restoreLinks.some(
        (link) => link.tokenHash === tokenHash && link.expiresAt > now,
      )
    ) {
      throw linkInvalid();
    }

    const unusable = await bcryptjs.hash(
      newLinkToken(),
      ENVIRONMENT.BCRYPT_SALT_ROUNDS,
    );
    const restored = await this.users.restoreFromLink(
      user.id,
      tokenHash,
      unusable,
      now,
    );
    if (!restored) throw linkInvalid();
    await this.sessions.revokeAllForUser(restored.id);
    if (user.emailChange) {
      await this.codes.discard(
        "email-change",
        emailChangeKey(user.id, user.emailChange.email),
      );
    }
    return {
      email: restored.email,
      codeSent: await sendResetAfterLink(
        { codes: this.codes, email: this.email, now: this.now },
        restored,
        true,
      ),
    };
  }
}
