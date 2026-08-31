import { PipelineStage } from "mongoose";
import { v7 as uuidv7 } from "uuid";

import { Transaction } from "../../../domain/entities/Transaction";
import {
  ITransactionRepository,
  SpendingQuery,
  SpendingResult,
  TransactionFilters,
  TransactionRevision,
} from "../../../domain/repositories/transaction/ITransactionRepository";
import { ApiError } from "../../../shared/errors";
import { fromCents, toCents } from "../../../shared/money";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import {
  ITransactionDocument,
  TransactionModel,
} from "../../models/TransactionModel";

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
      source: doc.source as Transaction["source"],
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
      // Scoped to the owner so foreign ids can't act as pivots (id oracle).
      const cursorDoc = await TransactionModel.findOne({
        _id: cursor,
        ...(baseFilter.userId ? { userId: baseFilter.userId } : {}),
      })
        .select("date")
        .lean();
      if (!cursorDoc) {
        // Silently serving page 1 made infinite scroll duplicate items.
        throw new ApiError(
          "BadRequest",
          "Invalid pagination cursor",
          "INVALID_CURSOR",
        );
      }
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
      // userId inside each branch so the planner can index-union the $or.
      filter.$or = [
        { userId, fromAccountId: filters.accountId },
        { userId, toAccountId: filters.accountId },
      ];
    }
    if (filters?.categoryId) {
      filter.categoryId = filters.categoryId;
    }
    if (filters?.uncategorized) {
      filter.categoryId = null;
    }
    if (filters?.type) {
      filter.type = filters.type;
    }
    if (filters?.pendingDetails !== undefined) {
      filter.pendingDetails = filters.pendingDetails;
    }
    if (filters?.from || filters?.to) {
      const range: Record<string, Date> = {};
      if (filters.from) range.$gte = filters.from;
      if (filters.to) range.$lt = filters.to;
      filter.date = range;
    }
    if (filters?.tag) {
      filter.tags = filters.tag;
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
    revision?: TransactionRevision,
  ): Promise<Transaction> {
    const update: Record<string, unknown> = {
      $set: this.toStorage(transaction),
    };
    if (revision) {
      update.$push = {
        revisions: {
          $each: [{ ...revision, amount: toCents(revision.amount) }],
          // Cap: keep only the most recent monetary edits.
          $slice: -20,
        },
      };
    }
    const doc = await TransactionModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      update,
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

  async countByCategory(userId: string, categoryId: string): Promise<number> {
    return TransactionModel.countDocuments({
      userId,
      categoryId,
      deletedAt: null,
    });
  }

  async listTags(userId: string): Promise<string[]> {
    const tags = await TransactionModel.distinct("tags", {
      userId,
      deletedAt: null,
    });
    return (tags as string[]).sort();
  }

  async aggregateSpending(
    userId: string,
    query: SpendingQuery,
  ): Promise<SpendingResult> {
    const match: Record<string, unknown> = { userId, deletedAt: null };
    // ADJUSTMENT is reconciliation, not real cash flow: hidden unless asked for.
    match.type = query.type ?? { $ne: "ADJUSTMENT" };
    if (query.from || query.to) {
      // Half-open range [from, to), consistent with budget windows.
      const range: Record<string, Date> = {};
      if (query.from) range.$gte = query.from;
      if (query.to) range.$lt = query.to;
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
          ? { $ifNull: ["$tags", "untagged"] }
          : { $ifNull: ["$categoryId", "uncategorized"] };

    const bucketStages: PipelineStage.FacetPipelineStage[] = [];
    if (query.groupBy === "tag") {
      bucketStages.push({
        $unwind: { path: "$tags", preserveNullAndEmptyArrays: true },
      });
    }
    bucketStages.push(
      {
        $group: {
          _id: groupId,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      // Day buckets are a time series; the rest rank by spend.
      query.groupBy === "day" ? { $sort: { _id: 1 } } : { $sort: { total: -1 } },
    );

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $facet: {
          buckets: bucketStages,
          totals: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
        },
      },
    ];

    const [result] = await TransactionModel.aggregate<{
      buckets: { _id: string; total: number; count: number }[];
      totals: { total: number }[];
    }>(pipeline);

    return {
      buckets: (result?.buckets ?? []).map((r) => ({
        key: String(r._id),
        total: fromCents(r.total),
        count: r.count,
        avg: fromCents(Math.round(r.total / r.count)),
      })),
      totalCents: result?.totals[0]?.total ?? 0,
    };
  }

  async sumAmountsByCategory(
    userId: string,
    from: Date,
    to: Date,
    categoryIds: string[],
    type: "EXPENSE" | "INCOME",
  ): Promise<Record<string, number>> {
    const rows = await TransactionModel.aggregate<{
      _id: string;
      total: number;
    }>([
      {
        $match: {
          userId,
          type,
          deletedAt: null,
          categoryId: { $in: categoryIds },
          date: { $gte: from, $lt: to },
        },
      },
      { $group: { _id: "$categoryId", total: { $sum: "$amount" } } },
    ]);
    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r._id] = r.total;
    }
    return map;
  }

  async sumAmounts(
    userId: string,
    from: Date,
    to: Date,
    type: "EXPENSE" | "INCOME",
  ): Promise<number> {
    const rows = await TransactionModel.aggregate<{ total: number }>([
      {
        $match: {
          userId,
          type,
          deletedAt: null,
          date: { $gte: from, $lt: to },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return rows[0]?.total ?? 0;
  }
}
