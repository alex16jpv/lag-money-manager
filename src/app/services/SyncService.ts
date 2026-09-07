import { Account } from "../../domain/entities/Account";
import { Budget } from "../../domain/entities/Budget";
import { Category } from "../../domain/entities/Category";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IBudgetRepository } from "../../domain/repositories/budget/IBudgetRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import {
  ChangedTransaction,
  ITransactionRepository,
} from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import {
  ChangeCursor,
  ChangeKey,
  changeKeyOf,
  compareChanges,
  encodeCursor,
  isAfterCursor,
  SYNC_OVERLAP_MS,
} from "../../shared/syncCursor";
import { toUserResponse, UserResponseDTO } from "../dtos/UserDTO";

export interface SyncChanges {
  user: UserResponseDTO | null;
  accounts: Account[];
  categories: Category[];
  transactions: ChangedTransaction[];
  budgets: Budget[];
}

export interface SyncChangesResult {
  serverTime: Date;
  changes: SyncChanges;
  pagination: {
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string;
  };
}

export class SyncService {
  constructor(
    private users: IUserRepository,
    private accounts: IAccountRepository,
    private categories: ICategoryRepository,
    private transactions: ITransactionRepository,
    private budgets: IBudgetRepository,
  ) {}

  /**
   * One page of the offline mirror's feed. No `cursor` is a full snapshot, by
   * this same path: a separate snapshot endpoint would be a second definition
   * of "everything the client needs" and the two would drift.
   */
  async getChanges(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<SyncChangesResult> {
    // Read the clock BEFORE the queries. The watermark handed back must never
    // claim to cover a write that landed while this page was being read.
    const serverTime = new Date();

    // One row past the page is what separates "there is more" from "that was
    // the end" without a second round trip. Taking limit+1 from every source
    // is also what makes the merge exact: the global first `limit` rows cannot
    // need more than limit+1 from any one of them.
    const fetch = limit + 1;
    const [user, accounts, categories, transactions, budgets] =
      await Promise.all([
        this.users.getById(userId),
        this.accounts.changesSince(userId, cursor, fetch),
        this.categories.changesSince(userId, cursor, fetch),
        this.transactions.changesSince(userId, cursor, fetch),
        this.budgets.changesSince(userId, cursor, fetch),
      ]);

    // The user is a single document: filtering it here costs one comparison
    // and keeps it inside the same ordering as everything else, so a page
    // boundary can never drop it.
    const users =
      user && isAfterCursor(user, cursor) ? [toUserResponse(user)] : [];

    const ordered = [
      ...users,
      ...accounts,
      ...categories,
      ...transactions,
      ...budgets,
    ]
      .map(changeKeyOf)
      .sort(compareChanges);

    const hasMore = ordered.length > limit;
    const last = ordered[Math.min(limit, ordered.length) - 1];
    const upTo = <T extends ChangeKey>(rows: T[]): T[] =>
      last ? rows.filter((row) => compareChanges(row, last) <= 0) : [];

    const changes: SyncChanges = {
      user: upTo(users)[0] ?? null,
      accounts: upTo(accounts),
      categories: upTo(categories),
      transactions: upTo(transactions),
      budgets: upTo(budgets),
    };

    return {
      serverTime,
      changes,
      pagination: {
        limit,
        count: Math.min(ordered.length, limit),
        hasMore,
        // Mid-run the cursor is the exact row we stopped at; only a finished
        // run may advance the watermark, and it stops a minute short of now
        // (see SYNC_OVERLAP_MS).
        nextCursor: encodeCursor(
          hasMore && last
            ? { updatedAt: last.updatedAt, id: last.id }
            : {
                updatedAt: new Date(serverTime.getTime() - SYNC_OVERLAP_MS),
                id: null,
              },
        ),
      },
    };
  }
}
