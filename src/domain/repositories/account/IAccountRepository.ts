import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { Account } from "../../entities/Account";
import { IRepository } from "../IRepository";

export interface IAccountRepository extends IRepository<Account> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Account>>;
}
