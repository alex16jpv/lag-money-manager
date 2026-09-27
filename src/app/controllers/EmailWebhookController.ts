import { NextFunction, Request, Response } from "express";

import { EmailEvent } from "../../domain/email/EmailEvent";
import {
  ISnsInbox,
  SnsMessage,
  SnsRejection,
  SnsUnavailable,
} from "../../domain/email/SnsInbox";
import logger from "../../shared/logger";
import { readSesEvent, UnreadableEmailEvent } from "../email/sesEvents";
import { EmailEventService } from "../services/EmailEventService";

export class EmailWebhookController {
  constructor(
    private readonly inbox: ISnsInbox,
    private readonly events: EmailEventService,
  ) {}

  verifySes = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    try {
      res.locals.snsMessage = await this.inbox.open(body);
    } catch (err) {
      if (this.answered(err, res)) return;
      throw err;
    }
    next();
  };

  handleSes = async (_req: Request, res: Response): Promise<void> => {
    const message = res.locals.snsMessage as SnsMessage;
    if (message.Type === "SubscriptionConfirmation") {
      try {
        await this.inbox.confirmSubscription(message);
      } catch (err) {
        if (this.answered(err, res)) return;
        throw err;
      }
      logger.info(
        { code: "EMAIL_EVENTS_SUBSCRIBED", topic: message.TopicArn },
        "Subscribed to the email events topic",
      );
    } else if (message.Type === "UnsubscribeConfirmation") {
      logger.error(
        { code: "EMAIL_EVENTS_UNSUBSCRIBED", topic: message.TopicArn },
        "Unsubscribed from the email events topic: bounces and complaints no longer arrive",
      );
    } else {
      await this.notification(message);
    }
    res.status(204).end();
  };

  private async notification(message: SnsMessage): Promise<void> {
    let event: EmailEvent | null;
    try {
      event = readSesEvent(message.Message);
    } catch (err) {
      if (!(err instanceof UnreadableEmailEvent)) throw err;
      logger.error(
        { code: "EMAIL_EVENT_UNREADABLE", reason: err.reason },
        "A signed email event could not be read; it is dropped, since a retry would read the same",
      );
      return;
    }
    if (event) await this.events.apply(event);
  }

  // The request log line carries the reason: one line per refused call, however many arrive.
  private answered(err: unknown, res: Response): boolean {
    if (err instanceof SnsRejection) {
      res.locals.errorCode = "EMAIL_EVENT_REJECTED";
      res.locals.errorMessage = err.reason;
      res
        .status(403)
        .json({ error: "ForbiddenError", message: "Access denied" });
      return true;
    }
    if (err instanceof SnsUnavailable) {
      res.locals.errorCode =
        err.step === "certificate"
          ? "EMAIL_EVENTS_CERTIFICATE_UNAVAILABLE"
          : "EMAIL_EVENTS_SUBSCRIPTION_FAILED";
      res.locals.errorMessage = `${err.message}: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`;
      res.status(503).json({
        error: "ServiceUnavailableError",
        message: "Try again later",
      });
      return true;
    }
    return false;
  }
}
