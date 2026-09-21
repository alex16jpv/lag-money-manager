import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import {
  SettlementCounterparty,
  SharedSettlement,
} from "../../entities/SharedSettlement";
import { IRepository } from "../IRepository";

export interface SettlementFilters {
  contactId?: string;
  expenseId?: string;
}

export interface ISharedSettlementRepository extends IRepository<SharedSettlement> {
  // Soft-deletes and answers the deleted row, so a queued write can guard on its updatedAt.
  delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedSettlement>;

  // Newest first, keyset over `(date, _id)`: a payment is recorded on the day it happened.
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: SettlementFilters,
  ): Promise<PaginatedResult<SharedSettlement>>;

  // Owner-scoped read for client-minted id replay; resolves deleted rows too.
  getOwnById(id: string, userId: string): Promise<SharedSettlement | null>;

  // Everything settled with one counterparty, which is what an imputation reads.
  listByCounterparty(
    userId: string,
    counterparty: SettlementCounterparty,
    session?: TxSession,
  ): Promise<SharedSettlement[]>;
}
