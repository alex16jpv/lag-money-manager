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
);

export class AuthController {
  static register = async (req: Request, res: Response) => {
    const user = await authService.register(req.body);
    res.status(201).json(user);
  };

  static login = async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.status(200).json(result);
  };
}
