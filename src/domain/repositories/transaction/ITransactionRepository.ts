import { TransactionSource, TransactionType } from "../../../shared/constants";
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { ChangeCursor } from "../../../shared/syncCursor";
import { Transaction } from "../../entities/Transaction";
import { IRepository } from "../IRepository";

/**
 * A transaction as the change feed reports it: the API shape plus the tombstone
 * flag. `deletedAt` is deliberately absent from every other response — a
 * deleted transaction leaves the listings — but the offline mirror has to be
 * told to drop its copy.
 */
export type ChangedTransaction = Transaction & { deletedAt: Date | null };

/**
 * A page of transactions, plus the summary when it was asked for. The sum
 * covers everything matching the filters, not the page — the screens that show
 * "3 to review · $47,900" need the total of the set, and computing it is an
 * extra aggregation, so it is opt-in rather than paid for on every listing.
 */
export interface TransactionPage extends PaginatedResult<Transaction> {
  summary?: { totalAmount: number };
}

export interface TransactionFilters {
  ids?: string[];
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  pendingDetails?: boolean;
  source?: TransactionSource;
  // Half-open [from, to), matched as the run of local days it covers in `timezone`.
  from?: Date;
  to?: Date;
  timezone?: string;
  tag?: string;
  uncategorized?: boolean;
  // Opt-in: adds the sum over the whole filtered set (one extra aggregation).
  includeSummary?: boolean;
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

// Capped, inside the document, so "why doesn't it balance" is answerable. Not exposed via API.
export interface TransactionRevision {
  at: Date;
  amount: number;
  type: TransactionType;
  fromAccountId: string | null;
  toAccountId: string | null;
  date: Date;
}

export interface SpendingResult {
  buckets: SpendingBucket[];
  // Computed WITHOUT the tag unwind: multi-tag buckets overlap and summing them double-counts.
  totalCents: number;
}

export interface ITransactionRepository extends IRepository<Transaction> {
  // Owner-scoped read for client-minted id replay; resolves archived/deleted too.
  getOwnById(id: string, userId: string): Promise<Transaction | null>;
  // §5.4: what tells a movement another device deleted from one that never existed.
  isDeleted(id: string, userId: string): Promise<boolean>;

  // Change feed after `cursor` in (updatedAt, _id) order, archived and deleted rows included.
  changesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<ChangedTransaction[]>;

  // `expectedUpdatedAt` goes in the write's own filter: a guard checked before would race.
  update(
    id: string,
    entity: Partial<Transaction>,
    session?: unknown,
    revision?: TransactionRevision,
    expectedUpdatedAt?: Date,
  ): Promise<Transaction>;

  delete(
    id: string,
    session?: unknown,
    expectedUpdatedAt?: Date,
  ): Promise<void>;

  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: TransactionFilters,
  ): Promise<TransactionPage>;

  aggregateSpending(
    userId: string,
    query: SpendingQuery,
  ): Promise<SpendingResult>;

  // Distinct tags of the user's active transactions (autocomplete source).
  listTags(userId: string): Promise<string[]>;

  countByCategory(userId: string, categoryId: string): Promise<number>;

  // Integer cents per category over the local days [from, to) in `timezone`. Budget spend/earned.
  sumAmountsByCategory(
    userId: string,
    from: Date,
    to: Date,
    categoryIds: string[],
    type: "EXPENSE" | "INCOME",
    timezone: string,
  ): Promise<Record<string, number>>;

  // Total cents over the same days regardless of category, so a global budget sees quick-adds.
  sumAmounts(
    userId: string,
    from: Date,
    to: Date,
    type: "EXPENSE" | "INCOME",
    timezone: string,
  ): Promise<number>;
}
