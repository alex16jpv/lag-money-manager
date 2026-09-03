import { Request, Response } from "express";

import repositoryFactory from "../factories/RepositoryFactory";
import { AuthService } from "../services/AuthService";
import { CategoryService } from "../services/CategoryService";

const categoryService = new CategoryService(
  repositoryFactory.getCategoryRepository(),
  repositoryFactory.getTransactionRepository(),
);
const authService = new AuthService(
  repositoryFactory.getUserRepository(),
  categoryService,
  repositoryFactory.getRefreshSessionRepository(),
);

export class AuthController {
  static register = async (req: Request, res: Response) => {
    const result = await authService.register(
      req.body,
      req.get("User-Agent") ?? undefined,
    );
    res.status(201).json(result);
  };

  static login = async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await authService.login(
      email,
      password,
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
    await authService.logoutAll(req.user!.userId);
    res.status(200).json({ message: "All sessions revoked" });
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
