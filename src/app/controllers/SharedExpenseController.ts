import { Request, Response } from "express";

import { extractPagination } from "../../shared/pagination";
import repositoryFactory from "../factories/RepositoryFactory";
import { sharedLedgerService } from "../factories/sharedLedger";
import { SharedExpenseService } from "../services/SharedExpenseService";
import { ifMatch } from "./ifMatch";

const sharedExpenseService = new SharedExpenseService(
  repositoryFactory.getSharedExpenseRepository(),
  repositoryFactory.getSharedGroupRepository(),
  repositoryFactory.getTransactionRepository(),
  sharedLedgerService,
);

export class SharedExpenseController {
  static getExpenses = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const result = await sharedExpenseService.getExpenses(
      userId,
      req.params.id as string,
      extractPagination(req),
    );
    res.status(200).json(result);
  };

  static getExpenseById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const expense = await sharedExpenseService.getExpenseById(
      req.params.expenseId as string,
      userId,
      req.params.id as string,
    );
    res.status(200).json(expense);
  };

  static createExpense = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const outcome = { replayed: false };
    const created = await sharedExpenseService.createExpense(
      { ...req.body, groupId: req.params.id as string, userId },
      outcome,
    );
    res.status(outcome.replayed ? 200 : 201).json(created);
  };

  static updateExpense = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const updated = await sharedExpenseService.updateExpense(
      req.params.expenseId as string,
      req.body,
      userId,
      ifMatch(req),
      req.params.id as string,
    );
    res.status(200).json(updated);
  };

  static deleteExpense = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const deleted = await sharedExpenseService.deleteExpense(
      req.params.expenseId as string,
      userId,
      ifMatch(req),
      req.params.id as string,
    );
    res.status(200).json(deleted);
  };
}
