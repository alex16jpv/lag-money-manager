import { NextFunction, Request, Response } from "express";

import {
  CaptchaAction,
  CaptchaVerifier,
} from "../../domain/captcha/CaptchaVerifier";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";
import { clientAddress } from "./clientIp";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- module augmentation of Express types requires a namespace
  namespace Express {
    interface Request {
      captchaPassed?: boolean;
    }
  }
}

async function checkCaptcha(
  req: Request,
  token: string,
  action: CaptchaAction,
  verifier: CaptchaVerifier,
): Promise<void> {
  const verdict = await verifier.verify({
    token,
    remoteIp: clientAddress(req),
    action,
  });
  if (verdict.passed) {
    req.captchaPassed = true;
    return;
  }
  if (verdict.reason === "unavailable") {
    logger.error(
      { code: "CAPTCHA_UNAVAILABLE", action, detail: verdict.detail },
      "The captcha could not be checked: nothing was sent",
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
}

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
    await checkCaptcha(
      req,
      (req.body as { captcha: string }).captcha,
      action,
      verifier,
    );
    next();
  };
}

// A token sent is checked like requireCaptcha's; a request without one goes on unmarked.
export function captchaIfSent(
  action: CaptchaAction,
  verifier: CaptchaVerifier,
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { captcha } = req.body as { captcha?: string };
    if (captcha !== undefined) {
      await checkCaptcha(req, captcha, action, verifier);
    }
    next();
  };
}
