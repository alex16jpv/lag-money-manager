import { TxSession } from "../../../shared/unitOfWork";

export interface IIdempotencyRepository {
  findTransactionId(userId: string, key: string): Promise<string | null>;
  record(
    userId: string,
    key: string,
    transactionId: string,
    session?: TxSession,
  ): Promise<void>;
}
