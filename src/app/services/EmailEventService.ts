import { EmailEvent } from "../../domain/email/EmailEvent";
import { IEmailDeliveryRepository } from "../../domain/repositories/emailDelivery/IEmailDeliveryRepository";
import { IEmailSuppressionRepository } from "../../domain/repositories/emailSuppression/IEmailSuppressionRepository";
import {
  EMAIL_SUPPRESSION_REASONS,
  EmailDeliveryStatus,
  EmailEventKind,
} from "../../shared/constants";
import { hashEmailAddress } from "../../shared/emailHash";
import logger from "../../shared/logger";

const MOVES_FROM: Record<EmailEventKind, EmailDeliveryStatus[]> = {
  delivered: ["sent"],
  bounced: ["sent", "delivered"],
  complained: ["sent", "delivered", "bounced"],
};

export class EmailEventService {
  constructor(
    private readonly deliveries: IEmailDeliveryRepository,
    private readonly suppressions: IEmailSuppressionRepository,
  ) {}

  async apply(event: EmailEvent): Promise<void> {
    if (event.suppress) {
      const reason =
        event.kind === "complained"
          ? EMAIL_SUPPRESSION_REASONS.complaint
          : EMAIL_SUPPRESSION_REASONS.bounce;
      for (const toHash of new Set(event.recipients.map(hashEmailAddress))) {
        const added = await this.suppressions.suppress({
          toHash,
          reason,
          provider: event.provider,
          detail: event.detail,
          at: event.at,
        });
        if (added) {
          logger.warn(
            {
              code: "EMAIL_ADDRESS_SUPPRESSED",
              reason,
              provider: event.provider,
              detail: event.detail,
            },
            "An address bounced or complained: no more email goes to it",
          );
        }
      }
    }
    await this.deliveries.report({
      provider: event.provider,
      messageId: event.messageId,
      status: event.kind,
      from: MOVES_FROM[event.kind],
      at: event.at,
      detail: event.detail,
    });
  }
}
