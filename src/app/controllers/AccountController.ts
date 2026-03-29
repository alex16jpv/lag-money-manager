import { NextFunction, Request, Response } from "express";
import { AccountService } from "../services/AccountService";
import repositoryFactory from "../factories/RepositoryFactory";

const accountService = new AccountService(
  repositoryFactory.getAccountRepository(),
);

export class AccountController {
  static async getAllAccounts(req: Request, res: Response, next: NextFunction) {
    try {
      const accounts = await accountService.getAllAccounts();
      res.status(200).json(accounts);
    } catch (error) {
      next(error);
    }
  }

  static async createAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const newAccount = await accountService.createAccount(req.body);

      res.status(201).json(newAccount);
    } catch (error) {
      next(error);
    }
  }

  static async getAccountById(req: Request, res: Response, next: NextFunction) {
    try {
      const account = await accountService.getAccountById(
        Number(req.params.id),
      );
      res.status(200).json(account);
    } catch (error) {
      next(error);
    }
  }

  static async updateAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const updatedAccount = await accountService.updateAccount(id, req.body);

      res.status(200).json(updatedAccount);
    } catch (error) {
      next(error);
    }
  }

  static async deleteAccount(req: Request, res: Response, next: NextFunction) {
    try {
      await accountService.deleteAccount(Number(req.params.id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
