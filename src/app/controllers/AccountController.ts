import { Request, Response } from "express";
import { AccountService } from "../services/AccountService";
import repositoryFactory from "../factories/RepositoryFactory";

const accountService = new AccountService(
  repositoryFactory.getAccountRepository(),
);

export class AccountController {
  static getAllAccounts = async (_req: Request, res: Response) => {
    const accounts = await accountService.getAllAccounts();
    res.status(200).json(accounts);
  };

  static createAccount = async (req: Request, res: Response) => {
    const newAccount = await accountService.createAccount(req.body);
    res.status(201).json(newAccount);
  };

  static getAccountById = async (req: Request, res: Response) => {
    const account = await accountService.getAccountById(
      req.params.id as string,
    );
    res.status(200).json(account);
  };

  static updateAccount = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const updatedAccount = await accountService.updateAccount(id, req.body);
    res.status(200).json(updatedAccount);
  };

  static deleteAccount = async (req: Request, res: Response) => {
    await accountService.deleteAccount(req.params.id as string);
    res.status(204).send();
  };
}
