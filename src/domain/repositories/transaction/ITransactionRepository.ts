import { Transaction } from "../../entities/Transaction";

export interface ITransactionRepository {
  getById(id: number): Promise<Transaction | null>;
  getAll(): Promise<Transaction[]>;
  create(transaction: Partial<Transaction>): Promise<Transaction>;
  update(id: number, transaction: Partial<Transaction>): Promise<Transaction>;
  delete(id: number): Promise<void>;
}
