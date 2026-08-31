import { TxSession } from "../../../shared/unitOfWork";
import { IdempotencyKeyModel } from "../../models/IdempotencyKeyModel";
import { IIdempotencyRepository } from "./IIdempotencyRepository";

export class IdempotencyRepository implements IIdempotencyRepository {
  private id(userId: string, key: string): string {
    return `${userId}:${key}`;
  }

  async findTransactionId(userId: string, key: string): Promise<string | null> {
    const doc = await IdempotencyKeyModel.findById(this.id(userId, key)).lean();
    return doc ? doc.transactionId : null;
  }

  async record(
    userId: string,
    key: string,
    transactionId: string,
    session?: TxSession,
  ): Promise<void> {
    await IdempotencyKeyModel.create(
      [{ _id: this.id(userId, key), transactionId }],
      { session: session ?? undefined },
    );
  }
}
