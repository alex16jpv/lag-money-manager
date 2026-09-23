import { RestampedEntity, SyncOpStatus } from "../../../shared/syncBatch";

export interface RestampRecord {
  entity: RestampedEntity;
  id: string;
  previousUpdatedAt: Date;
  updatedAt: Date;
}

/** What `POST /sync` remembers about an operation it landed (D-2). */
export interface SyncOpRecord {
  status: SyncOpStatus;
  entityId: string;
  code: string | null;
  // A resend of a batch that landed only in part still has to move the guards behind it.
  restamped?: RestampRecord[];
}

export interface ISyncOpRepository {
  find(userId: string, opId: string): Promise<SyncOpRecord | null>;
  // Idempotent: a record already there, from a concurrent resend, is left as it is.
  record(userId: string, opId: string, record: SyncOpRecord): Promise<void>;
}
