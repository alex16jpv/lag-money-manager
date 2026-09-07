import { ApiError } from "./errors";

/**
 * A position in the change feed's `(updatedAt, _id)` order. A cursor with no
 * `id` is a bare instant — everything strictly after it, whatever the id — and
 * is what `?since=` and the end-of-run watermark resolve to.
 */
export interface ChangeCursor {
  updatedAt: Date;
  id: string | null;
}

/** Anything the feed can order: every entity carries both. */
export interface ChangeKey {
  updatedAt?: Date;
  id: string;
}

const CURSOR_VERSION = "v1";

/**
 * `updatedAt` is stamped by the application server (Mongoose timestamps), not
 * by MongoDB, so two instances with drifted clocks confirm writes out of
 * order. The watermark a finished run hands back is `serverTime - this`, never
 * the last row read: the client applies by id with upsert, so re-reading a
 * minute costs nothing and it is the only thing that closes that hole.
 */
export const SYNC_OVERLAP_MS = 60_000;

export const SYNC_DEFAULT_LIMIT = 200;
export const SYNC_MAX_LIMIT = 1000;

const invalidCursor = (): never => {
  throw new ApiError(
    "BadRequest",
    "Invalid pagination cursor",
    "INVALID_CURSOR",
  );
};

export function encodeCursor(cursor: ChangeCursor): string {
  const raw = `${CURSOR_VERSION}|${cursor.updatedAt.toISOString()}|${cursor.id ?? ""}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/** Opaque to the client; a malformed one is a 400, never a silent page one. */
export function decodeCursor(raw: string): ChangeCursor {
  const parts = Buffer.from(raw, "base64url").toString("utf8").split("|");
  if (parts.length !== 3 || parts[0] !== CURSOR_VERSION) return invalidCursor();
  const updatedAt = new Date(parts[1] as string);
  if (Number.isNaN(updatedAt.getTime())) return invalidCursor();
  return { updatedAt, id: parts[2] || null };
}

/**
 * Persisted rows always carry `updatedAt`; the entities type it optional only
 * because an instance that was never saved has none.
 */
export const changeKeyOf = (row: ChangeKey): Required<ChangeKey> => ({
  id: row.id,
  updatedAt: row.updatedAt ?? new Date(0),
});

const stamp = (row: ChangeKey): number => changeKeyOf(row).updatedAt.getTime();

export function compareChanges(a: ChangeKey, b: ChangeKey): number {
  const byTime = stamp(a) - stamp(b);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isAfterCursor(row: ChangeKey, cursor?: ChangeCursor): boolean {
  if (!cursor) return true;
  const byTime = stamp(row) - cursor.updatedAt.getTime();
  if (byTime !== 0) return byTime > 0;
  return cursor.id !== null && row.id > cursor.id;
}
