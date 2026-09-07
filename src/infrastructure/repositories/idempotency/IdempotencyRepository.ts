import {
  IdempotencyRecord,
  IIdempotencyRepository,
} from "../../../domain/repositories/idempotency/IIdempotencyRepository";
import { TxSession } from "../../../shared/unitOfWork";
import { IdempotencyKeyModel } from "../../models/IdempotencyKeyModel";

export class IdempotencyRepository implements IIdempotencyRepository {
  private id(userId: string, scope: string, key: string): string {
    return `${userId}:${scope}:${key}`;
  }

  async find(
    userId: string,
    scope: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const doc = await IdempotencyKeyModel.findById(
      this.id(userId, scope, key),
    ).lean();
    if (!doc) return null;
    return { transactionId: doc.transactionId, requestHash: doc.requestHash };
  }

  async record(
    userId: string,
    scope: string,
    key: string,
    transactionId: string,
    requestHash: string,
    session?: TxSession,
  ): Promise<void> {
    await IdempotencyKeyModel.create(
      [{ _id: this.id(userId, scope, key), transactionId, requestHash }],
      { session: session ?? undefined },
    );
  }
}
