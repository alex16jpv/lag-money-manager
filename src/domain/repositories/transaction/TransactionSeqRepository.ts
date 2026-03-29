import { ApiError } from "../../../shared/errors";
import { Transaction } from "../../entities/Transaction";
import { TransactionModel } from "../../models/TransactionModel";
import { ITransactionRepository } from "./ITransactionRepository";

export class TransactionSeqRepository implements ITransactionRepository {
  model: typeof TransactionModel;

  constructor() {
    this.model = TransactionModel;
  }

  async getById(id: number): Promise<Transaction | null> {
    const result = await this.model.findByPk(id);
    if (!result) {
      return null;
    }
    return new Transaction(result.toJSON());
  }

  async getAll(): Promise<Transaction[]> {
    const results = await this.model.findAll();
    return results.map((result) => new Transaction(result.toJSON()));
  }

  async create(transaction: Partial<Transaction>): Promise<Transaction> {
    const result = await this.model.create(transaction);
    return new Transaction(result.toJSON());
  }

  async update(
    id: number,
    transaction: Partial<Transaction>,
  ): Promise<Transaction> {
    const existing = await this.model.findByPk(id);
    if (!existing) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    await existing.update(transaction);
    await existing.reload();
    return new Transaction(existing.toJSON());
  }

  async delete(id: number): Promise<void> {
    const existing = await this.model.findByPk(id);
    if (!existing) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    await existing.destroy();
  }
}
