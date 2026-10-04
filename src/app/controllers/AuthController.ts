import { NextFunction, Request, Response } from "express";

import { ENVIRONMENT } from "../../shared/constants";
import { createEmailChangeService } from "../factories/emailChangeFactory";
import { createEmailService } from "../factories/emailServiceFactory";
import { createEmailVerificationService } from "../factories/emailVerificationFactory";
import repositoryFactory from "../factories/RepositoryFactory";
import { createSignUpService } from "../factories/signUpFactory";
import { AuthPayload } from "../middlewares/authMiddleware";
import { clientIp } from "../middlewares/clientIp";
import { attemptedEmail } from "../middlewares/loginAttempt";
import { AccountRestoreService } from "../services/AccountRestoreService";
import { AuthService } from "../services/AuthService";
import { CategoryService } from "../services/CategoryService";
import { EmailOutcome, EmailRequester } from "../services/EmailService";
import {
  FORGOT_FLOOR_MARGIN_MS,
  PasswordResetService,
} from "../services/PasswordResetService";
import { answerLimited, sendFailed } from "./emailOutcome";

const categoryService = new CategoryService(
  repositoryFactory.getCategoryRepository(),
  repositoryFactory.getTransactionRepository(),
);
const authService = new AuthService(
  repositoryFactory.getUserRepository(),
  categoryService,
  repositoryFactory.getRefreshSessionRepository(),
  createEmailService(),
);
const passwordResetService = new PasswordResetService(
  repositoryFactory.getUserRepository(),
  repositoryFactory.getAuthCodeRepository(),
  createEmailService(),
  repositoryFactory.getRefreshSessionRepository(),
  repositoryFactory.getSharedInvitationRepository(),
  authService,
  {
    resendAfterSeconds: ENVIRONMENT.EMAIL_ADDRESS_INTERVAL_SECONDS,
    floorMarginMs: FORGOT_FLOOR_MARGIN_MS,
  },
);

const verification = createEmailVerificationService(authService);
const emailChange = createEmailChangeService(authService);
const signUp = createSignUpService(authService);
const accountRestore = new AccountRestoreService(
  repositoryFactory.getUserRepository(),
  repositoryFactory.getAuthCodeRepository(),
  createEmailService(),
  repositoryFactory.getRefreshSessionRepository(),
);

const requesterOf = (req: Request): EmailRequester => ({
  ip: clientIp(req),
  recognizedDevice: req.recognizedDevice ?? null,
});

export class AuthController {
  static recognizeDevice = async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const email = attemptedEmail(req);
    if (email) {
      const device = await authService.recognizedDevice(
        (req.body as { deviceToken?: unknown } | undefined)?.deviceToken,
        email,
      );
      if (device) req.recognizedDevice = device;
    }
    next();
  };

  static signUp = async (req: Request, res: Response): Promise<void> => {
    const outcome = await signUp.start(req.body, requesterOf(req));
    if (outcome.status === "limited") {
      answerLimited(res, outcome.retryAfterSeconds);
      return;
    }
    res.status(202).json({
      signUpToken: outcome.signUpToken,
      expiresAt: outcome.expiresAt,
      resendAfterSeconds: outcome.resendAfterSeconds,
    });
  };

  static resendSignUp = async (req: Request, res: Response): Promise<void> => {
    const outcome = await signUp.resend(
      (req.body as { signUpToken: string }).signUpToken,
      requesterOf(req),
    );
    if (outcome.status === "limited") {
      answerLimited(res, outcome.retryAfterSeconds);
      return;
    }
    res.status(202).json({ resendAfterSeconds: outcome.resendAfterSeconds });
  };

  static confirmSignUp = async (req: Request, res: Response): Promise<void> => {
    const { signUpToken, code } = req.body as {
      signUpToken: string;
      code: string;
    };
    const result = await signUp.confirmCode(
      signUpToken,
      code,
      req.get("User-Agent") ?? undefined,
    );
    res.status(201).json(result);
  };

  static verifyEmail = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { code: string } | { token: string };
    if ("code" in body) {
      await verification.verifyCode(
        (req.user as AuthPayload).userId,
        body.code,
      );
      res
        .status(200)
        .json({ message: "Email confirmed", result: "email-confirmed" });
      return;
    }
    const result = await verification.verifyLink(body.token);
    res.status(200).json({
      message:
        result === "account-ready"
          ? "Account ready: sign in"
          : "Email confirmed",
      result,
    });
  };

  static resendVerification = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { userId, email } = req.user as AuthPayload;
    const device = await authService.recognizedDevice(
      (req.body as { deviceToken?: unknown }).deviceToken,
      email,
    );
    const outcome: EmailOutcome = await verification.resend(userId, {
      ip: clientIp(req),
      recognizedDevice: device,
    });
    if (outcome.status === "limited") {
      answerLimited(res, outcome.retryAfterSeconds);
      return;
    }
    if (outcome.status === "failed") throw sendFailed(outcome.reason);
    res
      .status(202)
      .json({ resendAfterSeconds: ENVIRONMENT.EMAIL_ADDRESS_INTERVAL_SECONDS });
  };

  static confirmEmailChange = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const body = req.body as
      { code: string } | { token: string; refreshToken?: string };
    const userAgent = req.get("User-Agent") ?? undefined;
    const result =
      "code" in body
        ? await emailChange.confirmCode(
            (req.user as AuthPayload).userId,
            body.code,
            userAgent,
          )
        : await emailChange.confirmLink(
            body.token,
            body.refreshToken,
            userAgent,
          );
    res.status(200).json(result);
  };

  static restoreFromLink = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const result = await accountRestore.restore(
      (req.body as { token: string }).token,
    );
    res.status(200).json(result);
  };

  static restoreAccount = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { email, password, deviceToken } = req.body;
    const result = await authService.restore(
      email,
      password,
      req.get("User-Agent") ?? undefined,
      deviceToken,
    );
    res.status(200).json(result);
  };

  static undoEmailChange = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const result = await emailChange.undo(
      (req.body as { token: string }).token,
    );
    res.status(200).json(result);
  };

  static login = async (req: Request, res: Response) => {
    const { email, password, deviceToken } = req.body;
    const result = await authService.login(
      email,
      password,
      req.get("User-Agent") ?? undefined,
      deviceToken,
    );
    res.status(200).json(result);
  };

  static forgotPassword = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const outcome = await passwordResetService.forgot(req.body.email, {
      ip: clientIp(req),
      recognizedDevice: req.recognizedDevice ?? null,
    });
    if (outcome.status === "limited") {
      answerLimited(res, outcome.retryAfterSeconds);
      return;
    }
    res.status(202).json({ resendAfterSeconds: outcome.resendAfterSeconds });
  };

  static resetPassword = async (req: Request, res: Response): Promise<void> => {
    const { newPassword, ...proof } = req.body;
    const result = await passwordResetService.reset(
      proof,
      newPassword,
      req.get("User-Agent") ?? undefined,
    );
    res.status(200).json(result);
  };

  static refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    const result = await authService.refresh(refreshToken);
    res.status(200).json(result);
  };

  static logout = async (req: Request, res: Response) => {
    await authService.logout(req.body.refreshToken);
    res.status(200).json({ message: "Session revoked" });
  };

  static logoutAll = async (req: Request, res: Response) => {
    const { deviceToken } = await authService.logoutAll(req.user!.userId);
    res.status(200).json({
      message: "All sessions revoked",
      ...(deviceToken ? { deviceToken } : {}),
    });
  };

  static listSessions = async (req: Request, res: Response) => {
    const { userId, sid } = req.user!;
    const sessions = await authService.listSessions(userId, sid);
    res.status(200).json({ data: sessions });
  };

  static revokeSession = async (req: Request, res: Response) => {
    await authService.revokeSession(req.user!.userId, req.params.id as string);
    res.status(200).json({ message: "Session revoked" });
  };
}
