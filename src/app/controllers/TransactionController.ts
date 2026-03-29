import { Request, Response } from "express";
import { TransactionService } from "../services/TransactionService";
import repositoryFactory from "../factories/RepositoryFactory";

const transactionService = new TransactionService(
  repositoryFactory.getTransactionRepository(),
  repositoryFactory.getAccountRepository(),
);

export class TransactionController {
  static getAllTransactions = async (_req: Request, res: Response) => {
    const transactions = await transactionService.getAllTransactions();
    res.status(200).json(transactions);
  };

  static getTransactionById = async (req: Request, res: Response) => {
    const transaction = await transactionService.getTransactionById(
      Number(req.params.id),
    );
    res.status(200).json(transaction);
  };

  static createTransaction = async (req: Request, res: Response) => {
    const newTransaction = await transactionService.createTransaction(req.body);
    res.status(201).json(newTransaction);
  };

  static updateTransaction = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const updatedTransaction = await transactionService.updateTransaction(
      id,
      req.body,
    );
    res.status(200).json(updatedTransaction);
  };

  static deleteTransaction = async (req: Request, res: Response) => {
    await transactionService.deleteTransaction(Number(req.params.id));
    res.status(204).send();
  };
}
