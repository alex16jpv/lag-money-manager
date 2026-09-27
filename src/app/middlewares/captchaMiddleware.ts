import { NextFunction, Request, Response } from "express";

import {
  CaptchaAction,
  CaptchaVerifier,
} from "../../domain/captcha/CaptchaVerifier";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";
import { clientAddress } from "./clientIp";

// Runs after validate(): the body's `captcha` is a token of the right shape by then.
export function requireCaptcha(
  action: CaptchaAction,
  verifier: CaptchaVerifier,
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const verdict = await verifier.verify({
      token: (req.body as { captcha: string }).captcha,
      remoteIp: clientAddress(req),
      action,
    });
    if (verdict.passed) {
      next();
      return;
    }
    if (verdict.reason === "unavailable") {
      logger.error(
        { code: "CAPTCHA_UNAVAILABLE", action, detail: verdict.detail },
        "The captcha could not be checked: the request was turned away",
      );
      throw new ApiError(
        "ServiceUnavailable",
        "The check that you are a person could not be run. Try again",
        "CAPTCHA_UNAVAILABLE",
      );
    }
    throw new ApiError(
      "BadRequest",
      `The check that you are a person did not pass (${verdict.detail})`,
      "CAPTCHA_INVALID",
    );
  };
}
