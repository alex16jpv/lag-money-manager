import { PipelineStage } from "mongoose";
import { v7 as uuidv7 } from "uuid";

import { Transaction } from "../../../domain/entities/Transaction";
import {
  ChangedTransaction,
  ITransactionRepository,
  SpendingGroupBy,
  SpendingQuery,
  SpendingResult,
  SpendingSplit,
  TransactionFilters,
  TransactionPage,
  TransactionRevision,
} from "../../../domain/repositories/transaction/ITransactionRepository";
import { dayKeyOf, lastDayKeyOf } from "../../../shared/dayKey";
import { ApiError } from "../../../shared/errors";
import { fromCents, toCents } from "../../../shared/money";
import {
  buildPaginatedResult,
  pageQueryLimit,
  PaginatedResult,
  PaginationParams,
  SORT_FIELDS,
  SortField,
  TransactionPagination,
} from "../../../shared/pagination";
import { ChangeCursor } from "../../../shared/syncCursor";
import { TxSession } from "../../../shared/unitOfWork";
import {
  ITransactionDocument,
  TransactionModel,
} from "../../models/TransactionModel";
import { CHANGE_FEED_SORT, changesSinceFilter } from "../changeFeed";
import { invalidCursor } from "../keysetCursor";

/**
 * Where the keyset reads its pivot. Exhaustive on purpose: a field added to
 * `SORT_FIELDS` and not here does not compile, instead of silently comparing
 * every row against a date.
 */
const pivotOf = (
  field: SortField,
  doc: Pick<ITransactionDocument, "date" | "amount">,
): Date | number => {
  switch (field) {
    case "date":
      return doc.date;
    case "amount":
      return doc.amount;
    default: {
      const unreached: never = field;
      throw new Error(`No keyset pivot for sort field ${String(unreached)}`);
    }
  }
};

export class TransactionRepository implements ITransactionRepository {
  private toEntity(doc: ITransactionDocument): Transaction {
    return new Transaction({
      id: doc._id,
      type: doc.type,
      amount: fromCents(doc.amount),
      date: doc.date,
      dayKey: doc.dayKey ?? null,
      categoryId: doc.categoryId ?? null,
      description: doc.description ?? null,
      fromAccountId: doc.fromAccountId ?? null,
      toAccountId: doc.toAccountId ?? null,
      userId: doc.userId,
      tags: doc.tags ?? [],
      note: doc.note ?? null,
      pendingDetails: doc.pendingDetails,
      source: doc.source as Transaction["source"],
      currency: doc.currency,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  /**
   * A calendar window is a run of local days, so it matches the frozen
   * `dayKey`. The second branch answers rows written before that field existed
   * by their instant, exactly as every read did before it; it matches nothing
   * once `npx tsx scripts/backfill-day-key.ts` has run, and can go then.
   */
  private dayWindow(
    from: Date | undefined,
    to: Date | undefined,
    timezone: string,
  ): Record<string, unknown>[] {
    const days: Record<string, string> = {};
    const instants: Record<string, Date> = {};
    if (from) {
      days.$gte = dayKeyOf(from, timezone);
      instants.$gte = from;
    }
    if (to) {
      days.$lte = lastDayKeyOf(to, timezone);
      instants.$lt = to;
    }
    return [{ dayKey: days }, { dayKey: null, date: instants }];
  }

  private toStorage(
    transaction: Partial<Transaction>,
  ): Record<string, unknown> {
    const doc: Record<string, unknown> = { ...transaction };
    if (transaction.amount !== undefined) {
      doc.amount = toCents(transaction.amount);
    }
    return doc;
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams | TransactionPagination,
    withSummary = false,
  ): Promise<TransactionPage> {
    const { limit, offset, cursor } = pagination;
    const sortField = "sort" in pagination ? pagination.sort : "date";
    const direction =
      "order" in pagination && pagination.order === "asc" ? 1 : -1;
    const beyond = direction === 1 ? "$gt" : "$lt";
    let filter: Record<string, unknown> = baseFilter;
    if (cursor) {
      // Backdating means the id alone cannot order; in getAllByUserId the pivot is the owner's (id oracle).
      const cursorDoc = await TransactionModel.findOne({
        _id: cursor,
        ...(baseFilter.userId ? { userId: baseFilter.userId } : {}),
      })
        .select(Object.keys(SORT_FIELDS).join(" "))
        .lean();
      if (!cursorDoc) throw invalidCursor();
      const pivot = pivotOf(sortField, cursorDoc);
      filter = {
        $and: [
          baseFilter,
          {
            $or: [
              { [sortField]: { [beyond]: pivot } },
              { [sortField]: pivot, _id: { [beyond]: cursor } },
            ],
          },
        ],
      };
    }

    const [docs, total, summary] = await Promise.all([
      TransactionModel.find(filter)
        .sort({ [sortField]: direction, _id: direction })
        .skip(cursor ? 0 : offset)
        .limit(pageQueryLimit(limit))
        .lean(),
      TransactionModel.countDocuments(baseFilter),
      // Deliberately without the cursor: the sum describes the filtered set, not the current page.
      withSummary
        ? TransactionModel.aggregate<{ totalAmount: number }>([
            { $match: baseFilter },
            { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
          ])
        : Promise.resolve(null),
    ]);

    const page = buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
    if (!summary) return page;
    // An empty match aggregates to no rows at all, which is a total of zero.
    return {
      ...page,
      summary: { totalAmount: fromCents(summary[0]?.totalAmount ?? 0) },
    };
  }

  async changesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<ChangedTransaction[]> {
    const docs = await TransactionModel.find(changesSinceFilter(userId, cursor))
      .sort(CHANGE_FEED_SORT)
      .limit(limit)
      .lean();
    return docs.map((doc) =>
      Object.assign(this.toEntity(doc), { deletedAt: doc.deletedAt ?? null }),
    );
  }

  async getOwnById(id: string, userId: string): Promise<Transaction | null> {
    const doc = await TransactionModel.findOne({ _id: id, userId }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async isDeleted(id: string, userId: string): Promise<boolean> {
    const doc = await TransactionModel.findOne({
      _id: id,
      userId,
      deletedAt: { $ne: null },
    })
      .select("_id")
      .lean();
    return doc !== null;
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
  ): Promise<TransactionPage> {
    const filter: Record<string, unknown> = { userId, deletedAt: null };
    if (filters?.ids?.length) {
      filter._id = { $in: filters.ids };
    }
    const branches: Record<string, unknown>[][] = [];
    if (filters?.accountId) {
      // userId inside each branch so the planner can index-union the $or.
      branches.push([
        { userId, fromAccountId: filters.accountId },
        { userId, toAccountId: filters.accountId },
      ]);
    }
    if (filters?.categoryId) {
      filter.categoryId = filters.categoryId;
    }
    // Three filters over one field, and the route refuses every pair: last wins, on purpose.
    if (filters?.categoryIds?.length) {
      filter.categoryId = { $in: filters.categoryIds };
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
    if (filters?.source) {
      filter.source = filters.source;
    }
    if (filters?.from || filters?.to) {
      if (!filters.timezone) {
        throw new Error("A date range needs the timezone that cuts its days");
      }
      branches.push(this.dayWindow(filters.from, filters.to, filters.timezone));
    }
    if (filters?.tag) {
      filter.tags = filters.tag;
    }
    if (branches.length === 1) {
      filter.$or = branches[0];
    } else if (branches.length > 1) {
      filter.$and = branches.map((branch) => ({ $or: branch }));
    }
    return this.paginatedFind(filter, pagination, filters?.includeSummary);
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
    expectedUpdatedAt?: Date,
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
      {
        _id: id,
        deletedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      update,
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    return this.toEntity(doc);
  }

  async delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<void> {
    const doc = await TransactionModel.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
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

  private spendingKey(
    groupBy: SpendingGroupBy,
    timezone: string,
  ): Record<string, unknown> {
    const day = {
      $ifNull: [
        "$dayKey",
        { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone } },
      ],
    };
    switch (groupBy) {
      case "day":
        return day;
      case "month":
        return { $substrBytes: [day, 0, 7] };
      case "account":
        // An increase-only ADJUSTMENT has no `fromAccountId`, so the other side is the account.
        return {
          $ifNull: [
            {
              $cond: [
                { $eq: ["$type", "INCOME"] },
                "$toAccountId",
                "$fromAccountId",
              ],
            },
            { $ifNull: ["$toAccountId", "unassigned"] },
          ],
        };
      case "tag":
        return { $ifNull: ["$tags", "untagged"] };
      case "category":
        return { $ifNull: ["$categoryId", "uncategorized"] };
      default: {
        const unreached: never = groupBy;
        throw new Error(`No spending key for ${String(unreached)}`);
      }
    }
  }

  async aggregateSpending(
    userId: string,
    query: SpendingQuery,
  ): Promise<SpendingResult> {
    const match: Record<string, unknown> = { userId, deletedAt: null };
    // ADJUSTMENT is reconciliation, not real cash flow: hidden unless asked for.
    match.type = query.type ?? { $ne: "ADJUSTMENT" };
    if (query.categoryIds?.length) {
      match.categoryId = { $in: query.categoryIds };
    }
    if (query.from || query.to) {
      match.$or = this.dayWindow(query.from, query.to, query.timezone);
    }

    const groupId = this.spendingKey(query.groupBy, query.timezone);
    // Day and month buckets are a time series; the rest rank by spend, and the key breaks a tie.
    const order: PipelineStage.FacetPipelineStage =
      query.groupBy === "day" || query.groupBy === "month"
        ? { $sort: { _id: 1 } }
        : { $sort: { total: -1, _id: 1 } };

    const bucketStages: PipelineStage.FacetPipelineStage[] = [];
    if (query.groupBy === "tag") {
      bucketStages.push({
        $unwind: { path: "$tags", preserveNullAndEmptyArrays: true },
      });
    }
    if (query.splitBy) {
      bucketStages.push(
        {
          $group: {
            _id: {
              key: groupId,
              split: { $ifNull: ["$categoryId", "uncategorized"] },
            },
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: "$_id.key",
            total: { $sum: "$total" },
            count: { $sum: "$count" },
            splits: {
              $push: { key: "$_id.split", total: "$total", count: "$count" },
            },
          },
        },
        {
          $set: {
            splits: {
              $sortArray: {
                input: "$splits",
                sortBy: { total: -1, key: 1 },
              },
            },
          },
        },
        order,
      );
    } else {
      bucketStages.push(
        {
          $group: {
            _id: groupId,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        order,
      );
    }

    const pipeline: PipelineStage[] = [{ $match: match }];
    if (query.groupBy === "tag") {
      // Only the tag unwind can put one row in two buckets, so only it needs a second pass.
      pipeline.push({
        $facet: {
          buckets: bucketStages,
          totals: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
        },
      });
    } else {
      pipeline.push(...(bucketStages as PipelineStage[]));
    }

    type Row = {
      _id: string;
      total: number;
      count: number;
      splits?: { key: string; total: number; count: number }[];
    };
    const result = await TransactionModel.aggregate<
      Row | { buckets: Row[]; totals: { total: number }[] }
    >(pipeline);

    const faceted = query.groupBy === "tag";
    const rows = faceted
      ? ((result[0] as { buckets: Row[] } | undefined)?.buckets ?? [])
      : (result as Row[]);

    const asBucket = (r: {
      key: string;
      total: number;
      count: number;
    }): SpendingSplit => ({
      key: r.key,
      total: fromCents(r.total),
      count: r.count,
      avg: fromCents(Math.round(r.total / r.count)),
    });

    return {
      buckets: rows.map((r) => ({
        ...asBucket({ key: String(r._id), total: r.total, count: r.count }),
        ...(r.splits ? { splits: r.splits.map(asBucket) } : {}),
      })),
      totalCents: faceted
        ? ((result[0] as { totals: { total: number }[] } | undefined)?.totals[0]
            ?.total ?? 0)
        : rows.reduce((acc, r) => acc + r.total, 0),
    };
  }

  async sumAmountsByCategory(
    userId: string,
    from: Date,
    to: Date,
    categoryIds: string[],
    type: "EXPENSE" | "INCOME",
    timezone: string,
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
          $or: this.dayWindow(from, to, timezone),
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
    timezone: string,
  ): Promise<number> {
    const rows = await TransactionModel.aggregate<{ total: number }>([
      {
        $match: {
          userId,
          type,
          deletedAt: null,
          $or: this.dayWindow(from, to, timezone),
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return rows[0]?.total ?? 0;
  }
}
