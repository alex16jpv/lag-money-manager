import { Request, Response } from "express";

import { createEmailVerificationService } from "../factories/emailVerificationFactory";
import repositoryFactory from "../factories/RepositoryFactory";
import { AuthPayload } from "../middlewares/authMiddleware";
import { clientIp } from "../middlewares/clientIp";
import { CategoryService } from "../services/CategoryService";
import { KeepOrStartFreshService } from "../services/KeepOrStartFreshService";
import { UserService } from "../services/UserService";

const userService = new UserService(
  repositoryFactory.getUserRepository(),
  repositoryFactory.getAccountRepository(),
  repositoryFactory.getSharedInvitationRepository(),
  createEmailVerificationService(),
);
const keepOrStartFreshService = new KeepOrStartFreshService(
  repositoryFactory.getUserRepository(),
  repositoryFactory.getSharedInvitationRepository(),
  repositoryFactory.getUserDataEraser(),
  new CategoryService(
    repositoryFactory.getCategoryRepository(),
    repositoryFactory.getTransactionRepository(),
  ),
);

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
    const updatedUser = await userService.updateUser(id, req.body, userId, {
      ip: clientIp(req),
      recognizedDevice: null,
    });
    res.status(200).json(updatedUser);
  };

  static deleteUser = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    await userService.deleteUser(id, userId, req.body.currentPassword);
    res.status(200).json({ message: "User deleted successfully" });
  };

  static keepOrStartFresh = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { userId, iat } = req.user as AuthPayload;
    const session = { userId, issuedAt: iat };
    const id = req.params.id as string;
    const { choice, ...details } = req.body;
    const user =
      choice === "keep"
        ? await keepOrStartFreshService.keep(id, session)
        : await keepOrStartFreshService.startFresh(id, session, details);
    res.status(200).json(user);
  };
}
