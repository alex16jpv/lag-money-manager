import { Response } from "express";

import { ApiError } from "../../shared/errors";
import { EmailOutcome } from "../services/EmailService";

type Failure = Extract<EmailOutcome, { status: "failed" }>["reason"];

// Only for an address the caller chose or owns: to anyone else, a failed send would say the address exists.
export const sendFailed = (reason: Failure): ApiError =>
  reason === "rejected"
    ? new ApiError(
        "UnprocessableEntity",
        "This address does not accept our emails: check it, or change it",
        "EMAIL_SEND_FAILED",
      )
    : new ApiError(
        "ServiceUnavailable",
        "The email could not be sent. Try again in a few minutes",
        "EMAIL_SEND_FAILED",
      );

export const answerLimited = (
  res: Response,
  retryAfterSeconds: number,
): void => {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: "TooManyRequests",
    message: "Too many requests, please try again later",
    code: "RATE_LIMITED",
  });
};
