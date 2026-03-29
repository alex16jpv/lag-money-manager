import { NextFunction, Request, Response } from "express";
import { AuthService } from "../services/AuthService";
import repositoryFactory from "../factories/RepositoryFactory";

const authService = new AuthService(repositoryFactory.getUserRepository());

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await authService.register(req.body);
      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
