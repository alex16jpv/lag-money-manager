import { User } from "../../domain/entities/User";
import logger from "../../shared/logger";
import { EmailTemplateData, NoticeTemplate } from "../email/templates";
import { EmailOutcome, EmailService } from "./EmailService";

export type NoticeOwner = Pick<
  User,
  "id" | "email" | "locale" | "timezone" | "emailVerifiedAt"
>;

// Null: an address that is not confirmed gets no notice.
export async function sendSecurityNotice<T extends NoticeTemplate>(
  email: Pick<EmailService, "sendNotice">,
  owner: NoticeOwner,
  template: T,
  data: EmailTemplateData[T],
): Promise<EmailOutcome | null> {
  if (!owner.emailVerifiedAt) return null;
  try {
    return await email.sendNotice({
      template,
      data,
      recipient: {
        userId: owner.id,
        email: owner.email,
        locale: owner.locale,
        timezone: owner.timezone,
      },
    });
  } catch (err) {
    logger.error(
      { err, code: "SECURITY_NOTICE_NOT_SENT", template, userId: owner.id },
      "The change stands but its security notice could not be sent",
    );
    return { status: "failed", reason: "unavailable" };
  }
}

export const mayHaveArrived = (outcome: EmailOutcome | null): boolean =>
  outcome?.status === "sent" ||
  (outcome?.status === "failed" && outcome.reason === "unconfirmed");
