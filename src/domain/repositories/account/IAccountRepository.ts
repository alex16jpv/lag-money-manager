import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import { Account } from "../../entities/Account";
import { IRepository } from "../IRepository";

export interface AccountFilters {
  ids?: string[];
  includeArchived?: boolean;
}

export interface IAccountRepository extends IRepository<Account> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: AccountFilters,
  ): Promise<PaginatedResult<Account>>;

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
  archiveNonDefault(id: string, userId: string): Promise<boolean>;

  // Un-archives the user's own archived account; null if none to restore.
  restore(id: string, userId: string): Promise<Account | null>;

  getDefaultByUserId(userId: string): Promise<Account | null>;
  // Sets this account as the user's only default; null if not found.
  setDefault(id: string, userId: string): Promise<Account | null>;
  countByUserId(userId: string): Promise<number>;
}
