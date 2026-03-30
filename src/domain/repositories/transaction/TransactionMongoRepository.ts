import { v7 as uuidv7 } from "uuid";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { Transaction } from "../../entities/Transaction";
import { TransactionMongoModel } from "../../models/mongoose/TransactionMongoModel";
import { ITransactionRepository } from "./ITransactionRepository";

export class TransactionMongoRepository implements ITransactionRepository {
  private toEntity(doc: Record<string, unknown>): Transaction {
    return new Transaction({
      id: doc._id as string,
      type: doc.type as Transaction["type"],
      amount: doc.amount as number,
      date: doc.date as Date,
      categoryId: (doc.categoryId as string) ?? null,
      description: (doc.description as string) ?? null,
      fromAccountId: (doc.fromAccountId as string) ?? null,
      toAccountId: (doc.toAccountId as string) ?? null,
      userId: doc.userId as string,
      tags: (doc.tags as string) ?? null,
      note: (doc.note as string) ?? null,
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    });
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>> {
    const { limit, offset, cursor } = pagination;
    const filter = { ...baseFilter };
    if (cursor) {
      filter._id = { $gt: cursor };
    }

    const [docs, total] = await Promise.all([
      TransactionMongoModel.find(filter)
        .sort({ _id: 1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      TransactionMongoModel.countDocuments(baseFilter),
    ]);

    return buildPaginatedResult(
      docs.map((doc) =>
        this.toEntity(doc as unknown as Record<string, unknown>),
      ),
      total,
      pagination,
    );
  }

  async getById(id: string): Promise<Transaction | null> {
    const doc = await TransactionMongoModel.findById(id).lean();
    if (!doc) return null;
    return this.toEntity(doc as unknown as Record<string, unknown>);
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>> {
    return this.paginatedFind({}, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>> {
    return this.paginatedFind({ userId }, pagination);
  }

  async create(transaction: Partial<Transaction>): Promise<Transaction> {
    const id = uuidv7();
    const doc = await TransactionMongoModel.create({ _id: id, ...transaction });
    return this.toEntity(doc.toObject() as unknown as Record<string, unknown>);
  }

  async update(
    id: string,
    transaction: Partial<Transaction>,
  ): Promise<Transaction> {
    const doc = await TransactionMongoModel.findByIdAndUpdate(id, transaction, {
      new: true,
    }).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    return this.toEntity(doc as unknown as Record<string, unknown>);
  }

  async delete(id: string): Promise<void> {
    const doc = await TransactionMongoModel.findByIdAndDelete(id);
    if (!doc) {
      throw new ApiError("NotFound", "Transaction not found");
    }
  }
}
