import { Request, Response } from "express";
import { AccountService } from "../services/AccountService";
import repositoryFactory from "../factories/RepositoryFactory";
import { asyncHandler } from "../../shared/asyncHandler";

const accountService = new AccountService(
  repositoryFactory.getAccountRepository(),
);

export class AccountController {
  static getAllAccounts = asyncHandler(async (_req: Request, res: Response) => {
    const accounts = await accountService.getAllAccounts();
    res.status(200).json(accounts);
  });

  static createAccount = asyncHandler(async (req: Request, res: Response) => {
    const newAccount = await accountService.createAccount(req.body);
    res.status(201).json(newAccount);
  });

  static getAccountById = asyncHandler(async (req: Request, res: Response) => {
    const account = await accountService.getAccountById(Number(req.params.id));
    res.status(200).json(account);
  });

  static updateAccount = asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const updatedAccount = await accountService.updateAccount(id, req.body);
    res.status(200).json(updatedAccount);
  });

  static deleteAccount = asyncHandler(async (req: Request, res: Response) => {
    await accountService.deleteAccount(Number(req.params.id));
    res.status(204).send();
  });
}
