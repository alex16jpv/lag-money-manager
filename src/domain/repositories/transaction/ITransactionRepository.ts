import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { Transaction } from "../../entities/Transaction";
import { IRepository } from "../IRepository";

export interface ITransactionRepository extends IRepository<Transaction> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>>;
}
