import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import { SharedExpense } from "../../entities/SharedExpense";
import { SettlementCounterparty } from "../../entities/SharedSettlement";
import { IRepository } from "../IRepository";

/** What a group's expenses add up to; the group derives its range from it. */
export interface GroupTotals {
  groupId: string;
  total: number;
  yourShare: number;
  // What people still owe you here, what you still owe them, and what has already come back.
  owedToYou: number;
  youOwe: number;
  collected: number;
  expenseCount: number;
  dateFrom: Date | null;
  dateTo: Date | null;
}

export interface ISharedExpenseRepository extends IRepository<SharedExpense> {
  // `expectedUpdatedAt` goes in the write's own filter: a guard checked before would race.
  update(
    id: string,
    entity: Partial<SharedExpense>,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedExpense>;
  // Soft-deletes and answers the deleted row.
  delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedExpense>;

  // Newest expense first, keyset over (date, _id): ids are minted on creation, not on the day spent.
  getAllByGroup(
    userId: string,
    groupId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedExpense>>;
  // Owner-scoped read for client-minted id replay; resolves deleted rows too.
  getOwnById(id: string, userId: string): Promise<SharedExpense | null>;
  // Unlike getById, also resolves deleted expenses (read paths only).
  getByIdIncludingDeleted(id: string): Promise<SharedExpense | null>;
  // Every live expense of one group, for a re-split that has to be all or nothing.
  listByGroup(
    userId: string,
    groupId: string,
    session?: TxSession,
  ): Promise<SharedExpense[]>;
  // Every live expense, in any group, where this counterparty holds a share. The imputation reads it.
  listByCounterparty(
    userId: string,
    counterparty: SettlementCounterparty,
    session?: TxSession,
  ): Promise<SharedExpense[]>;

  // Live expenses of the group where this contact holds a share.
  countSharesOfContact(
    userId: string,
    groupId: string,
    contactId: string,
  ): Promise<number>;
  // One aggregation for a whole page of groups; a group with no expenses is absent.
  totalsByGroup(userId: string, groupIds: string[]): Promise<GroupTotals[]>;
  // Replaces the shares of many expenses in one round trip, inside the caller's transaction.
  replaceSplits(
    updates: { id: string; split: SharedExpense["split"] }[],
    session: TxSession,
  ): Promise<void>;
}
