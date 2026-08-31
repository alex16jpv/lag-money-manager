import { TxSession } from "../../../shared/unitOfWork";

export interface IdempotencyRecord {
  transactionId: string;
  requestHash: string;
}

export interface IIdempotencyRepository {
  find(
    userId: string,
    scope: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  record(
    userId: string,
    scope: string,
    key: string,
    transactionId: string,
    requestHash: string,
    session?: TxSession,
  ): Promise<void>;
}
