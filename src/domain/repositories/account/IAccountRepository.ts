import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import { Account } from "../../entities/Account";
import { IRepository } from "../IRepository";

export interface AccountFilters {
  ids?: string[];
  includeArchived?: boolean;
}

export interface IAccountRepository extends IRepository<Account> {
  // `expectedUpdatedAt` goes into the write's own filter: an optimistic guard
  // checked before the write would let two racing callers through.
  update(
    id: string,
    entity: Partial<Account>,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<Account>;

  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: AccountFilters,
  ): Promise<PaginatedResult<Account>>;

  // Owner-scoped read for client-minted id replay; resolves archived/deleted too.
  getOwnById(id: string, userId: string): Promise<Account | null>;
  // Unlike getById, also resolves archived accounts (read paths only).
  getByIdIncludingArchived(id: string): Promise<Account | null>;

  // Atomic balance change (decimal delta) via $inc; false when no account
  // matched — callers must treat that as corruption, never ignore it.
  incrementBalance(
    id: string,
    delta: number,
    session?: TxSession,
  ): Promise<boolean>;

  // Atomic archive that refuses the default account even under races;
  // false when nothing matched (default, archived or missing).
  archiveNonDefault(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<boolean>;

  // Un-archives the user's own archived account; null if none to restore.
  // `name` renames as part of the same write, so the unique index sees the
  // final state and no one can take the name in between.
  restore(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<Account | null>;

  getDefaultByUserId(userId: string): Promise<Account | null>;
  // Sets this account as the user's only default; null if not found.
  setDefault(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Account | null>;
  countByUserId(userId: string): Promise<number>;
}
