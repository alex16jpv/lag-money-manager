import { Request, Response } from "express";
import { AccountService } from "../services/AccountService";
import repositoryFactory from "../factories/RepositoryFactory";
import { extractPagination } from "../../shared/pagination";
import { AccountFilters } from "../../domain/repositories/account/IAccountRepository";

const accountService = new AccountService(
  repositoryFactory.getAccountRepository(),
);

export class AccountController {
  static getAllAccounts = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const filters: AccountFilters = {};
    if (req.query.ids) {
      filters.ids = req.query.ids as string[];
    }
    const result = await accountService.getAllAccounts(
      userId,
      extractPagination(req),
      filters,
    );
    res.status(200).json(result);
  };

  static createAccount = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const newAccount = await accountService.createAccount({
      ...req.body,
      userId,
    });
    res.status(201).json(newAccount);
  };

  static getAccountById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const account = await accountService.getAccountById(
      req.params.id as string,
      userId,
    );
    res.status(200).json(account);
  };

  static updateAccount = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const updatedAccount = await accountService.updateAccount(
      id,
      req.body,
      userId,
    );
    res.status(200).json(updatedAccount);
  };

  static deleteAccount = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    await accountService.deleteAccount(req.params.id as string, userId);
    res.status(204).send();
  };
}
