import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { ChangeCursor } from "../../../shared/syncCursor";
import { TxSession } from "../../../shared/unitOfWork";
import { Account } from "../../entities/Account";
import { IRepository } from "../IRepository";

export interface AccountFilters {
  ids?: string[];
  includeArchived?: boolean;
}

export interface IAccountRepository extends IRepository<Account> {
  // `expectedUpdatedAt` goes in the write's own filter: a guard checked before would race.
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

  // Change feed after `cursor` in (updatedAt, _id) order, archived and deleted rows included.
  changesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<Account[]>;
  // Unlike getById, also resolves archived accounts (read paths only).
  getByIdIncludingArchived(id: string): Promise<Account | null>;

  // The ACTIVE row holding this name, matched as the unique index does; null when it is free.
  findActiveByName(userId: string, name: string): Promise<Account | null>;

  // Atomic $inc; false when nothing matched, which callers must treat as corruption.
  incrementBalance(
    id: string,
    delta: number,
    session?: TxSession,
  ): Promise<boolean>;

  // Atomic archive that refuses the default account even under races.
  archiveNonDefault(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Account | null>;

  // `name` renames in the same write, so nobody can take the name in between.
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
