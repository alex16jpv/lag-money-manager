import { Request, Response } from "express";

import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import { createEmailChangeService } from "../factories/emailChangeFactory";
import { createEmailService } from "../factories/emailServiceFactory";
import { createEmailVerificationService } from "../factories/emailVerificationFactory";
import repositoryFactory from "../factories/RepositoryFactory";
import { AuthPayload } from "../middlewares/authMiddleware";
import { clientIp } from "../middlewares/clientIp";
import { AuthService } from "../services/AuthService";
import { CategoryService } from "../services/CategoryService";
import { EmailChangeRequest } from "../services/EmailChangeService";
import { EmailRequester } from "../services/EmailService";
import { UserService } from "../services/UserService";
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
const emailChangeService = createEmailChangeService(authService);
const userService = new UserService(
  repositoryFactory.getUserRepository(),
  repositoryFactory.getAccountRepository(),
  repositoryFactory.getSharedInvitationRepository(),
  createEmailVerificationService(authService),
  emailChangeService,
  repositoryFactory.getRefreshSessionRepository(),
  createEmailService(),
);

const ownId = (req: Request): string => {
  const { userId } = req.user as AuthPayload;
  if (req.params.id !== userId)
    throw new ApiError("NotFound", "User not found");
  return userId;
};

const requesterOf = async (req: Request): Promise<EmailRequester> => ({
  ip: clientIp(req),
  recognizedDevice: await authService.recognizedDevice(
    (req.body as { deviceToken?: unknown }).deviceToken,
    (req.user as AuthPayload).email,
  ),
});

const answerEmailChange = (res: Response, result: EmailChangeRequest): void => {
  if (result.status === "limited") {
    answerLimited(res, result.retryAfterSeconds);
    return;
  }
  if (result.status === "failed") throw sendFailed(result.reason);
  res.status(202).json({
    resendAfterSeconds: ENVIRONMENT.EMAIL_ADDRESS_INTERVAL_SECONDS,
    emailChange: result.emailChange,
  });
};

export class UserController {
  static getUserById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const user = await userService.getUserById(id, userId);
    res.status(200).json(user);
  };

  static updateUser = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const updatedUser = await userService.updateUser(
      id,
      req.body,
      userId,
      req.get("User-Agent") ?? undefined,
    );
    res.status(200).json(updatedUser);
  };

  static deleteUser = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const { keptUntil } = await userService.deleteUser(
      id,
      userId,
      req.body.currentPassword,
      req.get("User-Agent") ?? undefined,
    );
    res.status(200).json({ message: "User deleted successfully", keptUntil });
  };

  static requestEmailChange = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const userId = ownId(req);
    const { email, currentPassword } = req.body;
    const result = await emailChangeService.request(
      userId,
      email,
      currentPassword,
      await requesterOf(req),
      req.get("User-Agent") ?? undefined,
    );
    answerEmailChange(res, result);
  };

  static resendEmailChange = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const userId = ownId(req);
    const result = await emailChangeService.resend(
      userId,
      await requesterOf(req),
    );
    answerEmailChange(res, result);
  };

  static cancelEmailChange = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    await emailChangeService.cancel(ownId(req));
    res.status(200).json({ message: "Email change cancelled" });
  };
}
