import { Account } from "../../domain/entities/Account";
import { Budget } from "../../domain/entities/Budget";
import { Category } from "../../domain/entities/Category";
import { Contact } from "../../domain/entities/Contact";
import { SharedExpense } from "../../domain/entities/SharedExpense";
import { SharedGroup } from "../../domain/entities/SharedGroup";
import {
  ReceivedInvitationView,
  receivedView,
  SentInvitationView,
  sentView,
} from "../../domain/entities/SharedInvitation";
import { SharedSettlement } from "../../domain/entities/SharedSettlement";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IBudgetRepository } from "../../domain/repositories/budget/IBudgetRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";
import { ISharedSettlementRepository } from "../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
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
  // The shared layer: what everybody in a group would see, and never anybody's private figures.
  contacts: Contact[];
  sharedGroups: SharedGroup[];
  sharedExpenses: SharedExpense[];
  settlements: SharedSettlement[];
  invitationsSent: SentInvitationView[];
  invitationsReceived: ReceivedInvitationView[];
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
    private contacts: IContactRepository,
    private sharedGroups: ISharedGroupRepository,
    private sharedExpenses: ISharedExpenseRepository,
    private settlements: ISharedSettlementRepository,
    private invitations: ISharedInvitationRepository,
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
    // Read the clock BEFORE the queries: the watermark must not cover a write that landed meanwhile.
    const serverTime = new Date();

    // limit+1 from every source separates "there is more" from the end, and makes the merge exact.
    const fetch = limit + 1;
    const profile = this.users.getById(userId);
    const [
      user,
      accounts,
      categories,
      transactions,
      budgets,
      contacts,
      sharedGroups,
      sharedExpenses,
      settlements,
      sent,
      received,
    ] = await Promise.all([
      profile,
      this.accounts.changesSince(userId, cursor, fetch),
      this.categories.changesSince(userId, cursor, fetch),
      this.transactions.changesSince(userId, cursor, fetch),
      this.budgets.changesSince(userId, cursor, fetch),
      this.contacts.changesSince(userId, cursor, fetch),
      this.sharedGroups.changesSince(userId, cursor, fetch),
      this.sharedExpenses.changesSince(userId, cursor, fetch),
      this.settlements.changesSince(userId, cursor, fetch),
      this.invitations.sentChangesSince(userId, cursor, fetch),
      profile.then((me) =>
        me
          ? this.invitations.receivedChangesSince(
              userId,
              me.email,
              cursor,
              fetch,
            )
          : [],
      ),
    ]);

    // Filtering the user here costs one comparison and keeps it inside the same ordering.
    const users =
      user && isAfterCursor(user, cursor) ? [toUserResponse(user)] : [];

    const ordered = [
      ...users,
      ...accounts,
      ...categories,
      ...transactions,
      ...budgets,
      ...contacts,
      ...sharedGroups,
      ...sharedExpenses,
      ...settlements,
      ...sent,
      ...received,
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
      contacts: upTo(contacts),
      sharedGroups: upTo(sharedGroups),
      sharedExpenses: upTo(sharedExpenses),
      settlements: upTo(settlements),
      invitationsSent: upTo(sent).map(sentView),
      invitationsReceived: upTo(received).map(receivedView),
    };

    return {
      serverTime,
      changes,
      pagination: {
        limit,
        count: Math.min(ordered.length, limit),
        hasMore,
        // Only a finished run advances the watermark, and it stops a minute short (SYNC_OVERLAP_MS).
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
