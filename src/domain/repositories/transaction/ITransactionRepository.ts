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

export interface ITransactionRepository extends IRepository<Transaction> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: TransactionFilters,
  ): Promise<PaginatedResult<Transaction>>;

  aggregateSpending(
    userId: string,
    query: SpendingQuery,
  ): Promise<SpendingBucket[]>;

  // Sum of EXPENSE amounts (in integer cents) per category in [from, to),
  // restricted to the given categories. Used to compute budget spend.
  sumExpensesByCategory(
    userId: string,
    from: Date,
    to: Date,
    categoryIds: string[],
  ): Promise<Record<string, number>>;
}
