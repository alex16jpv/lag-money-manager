import { User } from "../../domain/entities/User";
import { IAuthCodeRepository } from "../../domain/repositories/authCode/IAuthCodeRepository";
import { hashEmailAddress } from "../../shared/emailHash";
import {
  codeDigest,
  newCode,
  newLinkToken,
  RESET_CODE_LIFETIME_MS,
  tokenDigest,
} from "./authCodes";
import { EmailOutcome, EmailRequester, EmailService } from "./EmailService";

export interface ResetCodeDeps {
  codes: Pick<IAuthCodeRepository, "issue">;
  email: Pick<EmailService, "sendCode">;
  now: () => Date;
}

// Both templates open the same reset row of the address, so /auth/password/reset redeems either.
export async function sendResetCode(
  deps: ResetCodeDeps,
  user: Pick<User, "id" | "email" | "locale" | "timezone">,
  template: "password-reset" | "password-reset-after-undo",
  requester: EmailRequester | null,
  brakesHeld: boolean,
): Promise<EmailOutcome> {
  const code = newCode();
  const token = newLinkToken();
  const outcome = await deps.email.sendCode({
    template,
    data: { code, token },
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
