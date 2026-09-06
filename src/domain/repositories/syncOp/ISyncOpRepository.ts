import { SyncOpStatus } from "../../../shared/syncBatch";

/** What `POST /sync` remembers about an operation it landed (D-2). */
export interface SyncOpRecord {
  status: SyncOpStatus;
  entityId: string;
  code: string | null;
}

export interface ISyncOpRepository {
  find(userId: string, opId: string): Promise<SyncOpRecord | null>;
  // Idempotent: a record already there (a concurrent resend of the same
  // batch) is left as it is.
  record(userId: string, opId: string, record: SyncOpRecord): Promise<void>;
}
