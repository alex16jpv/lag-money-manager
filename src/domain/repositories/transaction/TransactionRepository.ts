import { v7 as uuidv7 } from "uuid";

import { ApiError } from "../../../shared/errors";
import { fromCents, toCents } from "../../../shared/money";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import { Transaction } from "../../entities/Transaction";
import {
  ITransactionDocument,
  TransactionModel,
} from "../../models/TransactionModel";
import {
  ITransactionRepository,
  TransactionFilters,
} from "./ITransactionRepository";

export class TransactionRepository implements ITransactionRepository {
  private toEntity(doc: ITransactionDocument): Transaction {
    return new Transaction({
      id: doc._id,
      type: doc.type,
      amount: fromCents(doc.amount),
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

  /** Converts a partial entity's decimal amount to stored cents. */
  private toStorage(transaction: Partial<Transaction>): Record<string, unknown> {
    const doc: Record<string, unknown> = { ...transaction };
    if (transaction.amount !== undefined) {
      doc.amount = toCents(transaction.amount);
    }
    return doc;
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>> {
    const { limit, offset, cursor } = pagination;
    let filter: Record<string, unknown> = baseFilter;
    if (cursor) {
      // Keyset over (date DESC, _id DESC): the id alone is not enough because
      // transactions can be backdated, so fetch the cursor doc's date.
      const cursorDoc = await TransactionModel.findById(cursor)
        .select("date")
        .lean();
      if (cursorDoc) {
        filter = {
          $and: [
            baseFilter,
            {
              $or: [
                { date: { $lt: cursorDoc.date } },
                { date: cursorDoc.date, _id: { $lt: cursor } },
              ],
            },
          ],
        };
      }
    }

    const [docs, total] = await Promise.all([
      TransactionModel.find(filter)
        .sort({ date: -1, _id: -1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      TransactionModel.countDocuments(baseFilter),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async getById(id: string, session?: TxSession): Promise<Transaction | null> {
    const doc = await TransactionModel.findOne({ _id: id, deletedAt: null })
      .session(session ?? null)
      .lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>> {
    return this.paginatedFind({ deletedAt: null }, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: TransactionFilters,
  ): Promise<PaginatedResult<Transaction>> {
    const filter: Record<string, unknown> = { userId, deletedAt: null };
    if (filters?.ids?.length) {
      filter._id = { $in: filters.ids };
    }
    if (filters?.accountId) {
      filter.$or = [
        { fromAccountId: filters.accountId },
        { toAccountId: filters.accountId },
      ];
    }
    if (filters?.categoryId) {
      filter.categoryId = filters.categoryId;
    }
    if (filters?.type) {
      filter.type = filters.type;
    }
    return this.paginatedFind(filter, pagination);
  }

  async create(
    transaction: Partial<Transaction>,
    session?: TxSession,
  ): Promise<Transaction> {
    const id = uuidv7();
    const [doc] = await TransactionModel.create(
      [{ _id: id, ...this.toStorage(transaction) }],
      { session: session ?? undefined },
    );
    return this.toEntity(doc.toObject());
  }

  async update(
    id: string,
    transaction: Partial<Transaction>,
    session?: TxSession,
  ): Promise<Transaction> {
    const doc = await TransactionModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      this.toStorage(transaction),
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    return this.toEntity(doc);
  }

  async delete(id: string, session?: TxSession): Promise<void> {
    const doc = await TransactionModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Transaction not found");
    }
  }
}
