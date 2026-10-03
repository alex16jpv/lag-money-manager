import { User } from "../../domain/entities/User";
import { IAuthCodeRepository } from "../../domain/repositories/authCode/IAuthCodeRepository";
import { hashEmailAddress } from "../../shared/emailHash";
import logger from "../../shared/logger";
import { EmailTemplateData } from "../email/templates";
import {
  codeDigest,
  newCode,
  newLinkToken,
  RESET_CODE_LIFETIME_MS,
  tokenDigest,
} from "./authCodes";
import { EmailOutcome, EmailRequester, EmailService } from "./EmailService";
import { mayHaveArrived } from "./securityNotice";

export interface ResetCodeDeps {
  codes: Pick<IAuthCodeRepository, "issue">;
  email: Pick<EmailService, "sendCode">;
  now: () => Date;
}

type ResetTemplate = "password-reset" | "password-reset-after-undo";

// Both templates open the same reset row of the address, so /auth/password/reset redeems either.
export async function sendResetCode<T extends ResetTemplate>(
  deps: ResetCodeDeps,
  user: Pick<User, "id" | "email" | "locale" | "timezone">,
  template: T,
  words: Omit<EmailTemplateData[T], "code" | "token">,
  requester: EmailRequester | null,
  brakesHeld: boolean,
): Promise<EmailOutcome> {
  const code = newCode();
  const token = newLinkToken();
  const outcome = await deps.email.sendCode({
    template,
    data: { ...words, code, token } as EmailTemplateData[T],
    recipient: {
      userId: user.id,
      email: user.email,
      locale: user.locale,
      timezone: user.timezone,
    },
    requester,
    brakesHeld,
  });
  const unconfirmed =
    outcome.status === "failed" && outcome.reason === "unconfirmed";
  // A send that failed leaves the person with the code they already had.
  if (outcome.status !== "sent" && !unconfirmed) return outcome;
  const toHash = hashEmailAddress(user.email);
  await deps.codes.issue(
    "reset",
    toHash,
    {
      codeHash: codeDigest(toHash, code),
      tokenHash: tokenDigest(token),
      expiresAt: new Date(deps.now().getTime() + RESET_CODE_LIFETIME_MS),
    },
    unconfirmed,
    deps.now(),
  );
  return outcome;
}

// After "Undo the change" or "Restore account": the only way back in is a new password, so whether its code left is the answer.
export async function sendResetAfterLink(
  deps: ResetCodeDeps & { codes: Pick<IAuthCodeRepository, "recordRequest"> },
  user: Pick<User, "id" | "email" | "locale" | "timezone">,
  restored: boolean,
): Promise<boolean> {
  try {
    const now = deps.now();
    await deps.codes.recordRequest(
      "reset",
      hashEmailAddress(user.email),
      user.id,
      new Date(now.getTime() + RESET_CODE_LIFETIME_MS),
    );
    const outcome = await sendResetCode(
      deps,
      user,
      "password-reset-after-undo",
      restored ? { restored } : {},
      null,
      false,
    );
    return mayHaveArrived(outcome);
  } catch (err) {
    logger.error(
      { err, code: "UNDO_RESET_CODE_NOT_SENT", userId: user.id },
      "The link did its change but the code to choose a new password could not be sent",
    );
    return false;
  }
}
