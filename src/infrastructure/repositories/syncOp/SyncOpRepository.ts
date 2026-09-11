import {
  ISyncOpRepository,
  SyncOpRecord,
} from "../../../domain/repositories/syncOp/ISyncOpRepository";
import { isDuplicateIdError } from "../../../shared/clientMintedId";
import { SyncOpStatus } from "../../../shared/syncBatch";
import { SyncOpModel } from "../../models/SyncOpModel";

export class SyncOpRepository implements ISyncOpRepository {
  private id(userId: string, opId: string): string {
    return `${userId}:${opId}`;
  }

  async find(userId: string, opId: string): Promise<SyncOpRecord | null> {
    const doc = await SyncOpModel.findById(this.id(userId, opId)).lean();
    if (!doc) return null;
    return {
      status: doc.status as SyncOpStatus,
      entityId: doc.entityId,
      code: doc.code,
    };
  }

  async record(
    userId: string,
    opId: string,
    record: SyncOpRecord,
  ): Promise<void> {
    try {
      await SyncOpModel.create({
        _id: this.id(userId, opId),
        userId,
        opId,
        ...record,
      });
    } catch (err) {
      // Both applied the same desired state, so the first record is as true as this one.
      if (!isDuplicateIdError(err)) throw err;
    }
  }
}
