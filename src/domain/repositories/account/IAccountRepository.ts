import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import { Account } from "../../entities/Account";
import { IRepository } from "../IRepository";

export interface AccountFilters {
  ids?: string[];
}

export interface IAccountRepository extends IRepository<Account> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: AccountFilters,
  ): Promise<PaginatedResult<Account>>;

  /**
   * Atomically adds `delta` (a decimal amount, may be negative) to the
   * account's balance and returns the updated account, or null if not found.
   * Uses a single `$inc` so concurrent adjustments never lose updates.
   */
  incrementBalance(
    id: string,
    delta: number,
    session?: TxSession,
  ): Promise<Account | null>;
}
