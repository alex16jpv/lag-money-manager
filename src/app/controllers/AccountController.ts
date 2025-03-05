import { NextFunction, Request, Response } from "express";
import { AccountService } from "../services/AccountService";
import { Account } from "../../domain/entities/Account";
import repositoryFactory from "../factories/RepositoryFactory";
import { ApiError } from "../../shared/errors";

const accountService = new AccountService(
  repositoryFactory.getAccountRepository()
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
        Number(req.params.id)
      );
      res.status(200).json(account);
    } catch (error) {
      next(error);
    }
  }

  static async updateAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const account = req.body as Account;

      const updatedAccount = await accountService.updateAccount(id, account);

      res.status(200).json(updatedAccount);
    } catch (error) {
      next(error);
    }
  }
}
