import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
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
}
