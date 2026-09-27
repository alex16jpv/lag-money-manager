import express, { Router } from "express";
import rateLimit from "express-rate-limit";

import { EmailWebhookController } from "../controllers/EmailWebhookController";
import {
  createEmailEventService,
  createSesInbox,
} from "../factories/emailEventsFactory";
import { clientIp } from "../middlewares/clientIp";
import { dbReadinessMiddleware } from "../middlewares/dbReadinessMiddleware";

const EMAIL_WEBHOOK_BODY_LIMIT = "128kb";
const EMAIL_WEBHOOK_PER_MINUTE = 120;

export function emailWebhookRouter(controller: EmailWebhookController): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: EMAIL_WEBHOOK_PER_MINUTE,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientIp,
    message: {
      error: "TooManyRequests",
      message: "Too many requests, please try again later",
      code: "RATE_LIMITED",
    },
  });
  // SNS signs the exact bytes it sends, as text/plain: nothing may parse the body before this.
  const rawBody = express.raw({
    type: () => true,
    limit: EMAIL_WEBHOOK_BODY_LIMIT,
  });

  router.post(
    "/ses",
    limiter,
    rawBody,
    controller.verifySes,
    dbReadinessMiddleware,
    controller.handleSes,
  );
  return router;
}

export default emailWebhookRouter(
  new EmailWebhookController(createSesInbox(), createEmailEventService()),
);
