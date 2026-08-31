import { TransactionType } from "../../../shared/constants";
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { Transaction } from "../../entities/Transaction";
import { IRepository } from "../IRepository";

export interface TransactionFilters {
  ids?: string[];
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  pendingDetails?: boolean;
  // Half-open date range [from, to).
  from?: Date;
  to?: Date;
  tag?: string;
  uncategorized?: boolean;
}

export type SpendingGroupBy = "category" | "day" | "tag";

export interface SpendingQuery {
  from?: Date;
  to?: Date;
  type?: TransactionType;
  groupBy: SpendingGroupBy;
  timezone: string;
}

export interface SpendingBucket {
  key: string;
  total: number;
  count: number;
  avg: number;
}

export interface SpendingResult {
  buckets: SpendingBucket[];
  // Grand total in integer cents, computed WITHOUT the tag unwind: for
  // groupBy=tag the per-bucket totals overlap (multi-tag transactions), so
  // summing buckets would double-count.
  totalCents: number;
}

export interface ITransactionRepository extends IRepository<Transaction> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: TransactionFilters,
  ): Promise<PaginatedResult<Transaction>>;

  aggregateSpending(
    userId: string,
    query: SpendingQuery,
  ): Promise<SpendingResult>;

  // Distinct tags of the user's active transactions (autocomplete source).
  listTags(userId: string): Promise<string[]>;

  countByCategory(userId: string, categoryId: string): Promise<number>;

  // Sum of amounts (integer cents) of the given flow type per category in
  // [from, to), restricted to the given categories. Budget spend/earned.
  sumAmountsByCategory(
    userId: string,
    from: Date,
    to: Date,
    categoryIds: string[],
    type: "EXPENSE" | "INCOME",
  ): Promise<Record<string, number>>;

  // Total cents of the given flow type in [from, to) regardless of category
  // (uncategorized included) — a global budget sees quick-adds immediately.
  sumAmounts(
    userId: string,
    from: Date,
    to: Date,
    type: "EXPENSE" | "INCOME",
  ): Promise<number>;
}
