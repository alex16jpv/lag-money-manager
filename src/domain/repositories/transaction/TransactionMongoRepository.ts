import { v7 as uuidv7 } from "uuid";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { Transaction } from "../../entities/Transaction";
import {
  ITransactionDocument,
  TransactionMongoModel,
} from "../../models/mongoose/TransactionMongoModel";
import {
  ITransactionRepository,
  TransactionFilters,
} from "./ITransactionRepository";

export class TransactionMongoRepository implements ITransactionRepository {
  private toEntity(doc: ITransactionDocument): Transaction {
    return new Transaction({
      id: doc._id,
      type: doc.type,
      amount: doc.amount,
      date: doc.date,
      categoryId: doc.categoryId ?? null,
      description: doc.description ?? null,
      fromAccountId: doc.fromAccountId ?? null,
      toAccountId: doc.toAccountId ?? null,
      userId: doc.userId,
      tags: doc.tags ?? null,
      note: doc.note ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
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

    const hasFilter = Object.keys(baseFilter).length > 0;
    const [docs, total] = await Promise.all([
      TransactionMongoModel.find(filter)
        .sort({ _id: 1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      hasFilter
        ? TransactionMongoModel.countDocuments(baseFilter)
        : TransactionMongoModel.estimatedDocumentCount(),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async getById(id: string): Promise<Transaction | null> {
    const doc = await TransactionMongoModel.findById(id).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>> {
    return this.paginatedFind({}, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: TransactionFilters,
  ): Promise<PaginatedResult<Transaction>> {
    const filter: Record<string, unknown> = { userId };
    if (filters?.ids?.length) {
      filter._id = { $in: filters.ids };
    }
    if (filters?.accountId) {
      filter.$or = [
        { fromAccountId: filters.accountId },
        { toAccountId: filters.accountId },
      ];
    }
    if (filters?.type) {
      filter.type = filters.type;
    }
    return this.paginatedFind(filter, pagination);
  }

  async create(transaction: Partial<Transaction>): Promise<Transaction> {
    const id = uuidv7();
    const doc = await TransactionMongoModel.create({ _id: id, ...transaction });
    return this.toEntity(doc.toObject());
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
    return this.toEntity(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await TransactionMongoModel.findByIdAndDelete(id);
    if (!doc) {
      throw new ApiError("NotFound", "Transaction not found");
    }
  }
}
