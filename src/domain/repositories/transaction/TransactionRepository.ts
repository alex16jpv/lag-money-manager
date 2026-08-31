import { PipelineStage } from "mongoose";
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
  SpendingBucket,
  SpendingQuery,
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
      tags: doc.tags ?? [],
      note: doc.note ?? null,
      pendingDetails: doc.pendingDetails,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

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
    if (filters?.pendingDetails !== undefined) {
      filter.pendingDetails = filters.pendingDetails;
    }
    return this.paginatedFind(filter, pagination);
  }

  async create(
    transaction: Partial<Transaction>,
    session?: TxSession,
  ): Promise<Transaction> {
    const id = transaction.id ?? uuidv7();
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

  async aggregateSpending(
    userId: string,
    query: SpendingQuery,
  ): Promise<SpendingBucket[]> {
    const match: Record<string, unknown> = { userId, deletedAt: null };
    if (query.type) {
      match.type = query.type;
    }
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.$gte = query.from;
      if (query.to) range.$lte = query.to;
      match.date = range;
    }

    const groupId =
      query.groupBy === "day"
        ? {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$date",
              timezone: query.timezone,
            },
          }
        : query.groupBy === "tag"
          ? "$tags"
          : { $ifNull: ["$categoryId", "uncategorized"] };

    const pipeline: PipelineStage[] = [{ $match: match }];
    if (query.groupBy === "tag") {
      pipeline.push({ $unwind: "$tags" });
    }
    pipeline.push(
      {
        $group: {
          _id: groupId,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    );

    const rows = await TransactionModel.aggregate<{
      _id: string;
      total: number;
      count: number;
    }>(pipeline);

    return rows.map((r) => ({
      key: String(r._id),
      total: fromCents(r.total),
      count: r.count,
      avg: fromCents(Math.round(r.total / r.count)),
    }));
  }
}
