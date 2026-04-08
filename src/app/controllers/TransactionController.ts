import { Request, Response } from "express";
import { TransactionService } from "../services/TransactionService";
import repositoryFactory from "../factories/RepositoryFactory";
import { extractPagination } from "../../shared/pagination";
import { TransactionFilters } from "../../domain/repositories/transaction/ITransactionRepository";
import { TransactionType } from "../../shared/constants";

const transactionService = new TransactionService(
  repositoryFactory.getTransactionRepository(),
  repositoryFactory.getAccountRepository(),
);

export class TransactionController {
  static getAllTransactions = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const filters: TransactionFilters = {};
    if (req.query.ids) {
      filters.ids = (req.query.ids as string).split(",").map((s) => s.trim());
    }
    if (req.query.accountId) {
      filters.accountId = req.query.accountId as string;
    }
    if (req.query.type) {
      filters.type = req.query.type as TransactionType;
    }
    const result = await transactionService.getAllTransactions(
      userId,
      extractPagination(req),
      filters,
    );
    res.status(200).json(result);
  };

  static getTransactionById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const transaction = await transactionService.getTransactionById(
      req.params.id as string,
      userId,
    );
    res.status(200).json(transaction);
  };

  static createTransaction = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const newTransaction = await transactionService.createTransaction({
      ...req.body,
      userId,
    });
    res.status(201).json(newTransaction);
  };

  static updateTransaction = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const updatedTransaction = await transactionService.updateTransaction(
      id,
      req.body,
      userId,
    );
    res.status(200).json(updatedTransaction);
  };

  static deleteTransaction = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    await transactionService.deleteTransaction(req.params.id as string, userId);
    res.status(200).json({ message: 'Transaction deleted successfully' });
  };
}
