import { Request, Response } from "express";
import { AuthService } from "../services/AuthService";
import repositoryFactory from "../factories/RepositoryFactory";
import { asyncHandler } from "../../shared/asyncHandler";

const authService = new AuthService(repositoryFactory.getUserRepository());

export class AuthController {
  static register = asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.register(req.body);
    res.status(201).json(user);
  });

  static login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.status(200).json(result);
  });
}
