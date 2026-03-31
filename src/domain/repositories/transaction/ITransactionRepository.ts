import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { TransactionType } from "../../../shared/constants";
import { Transaction } from "../../entities/Transaction";
import { IRepository } from "../IRepository";

export interface TransactionFilters {
  accountId?: string;
  type?: TransactionType;
}

export interface ITransactionRepository extends IRepository<Transaction> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: TransactionFilters,
  ): Promise<PaginatedResult<Transaction>>;
}
