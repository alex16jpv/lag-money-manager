import { Request, Response } from "express";
import { TransactionService } from "../services/TransactionService";
import repositoryFactory from "../factories/RepositoryFactory";

const transactionService = new TransactionService(
  repositoryFactory.getTransactionRepository(),
  repositoryFactory.getAccountRepository(),
);

export class TransactionController {
  static getAllTransactions = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const transactions = await transactionService.getAllTransactions(userId);
    res.status(200).json(transactions);
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
    res.status(204).send();
  };
}
