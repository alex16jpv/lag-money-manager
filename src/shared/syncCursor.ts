import { ApiError } from "./errors";

/**
 * A position in the change feed's `(updatedAt, _id)` order. A cursor with no
 * `id` is a bare instant — everything strictly after it, whatever the id — and
 * is what `?since=` and the end-of-run watermark resolve to.
 */
export interface ChangeCursor {
  updatedAt: Date;
  id: string | null;
  // The account's dataResetAt the cursor was issued under; absent on a `?since=`, which cannot say.
  resetAt?: Date | null;
}

/** Anything the feed can order: every entity carries both. */
export interface ChangeKey {
  updatedAt?: Date;
  id: string;
}

const CURSOR_VERSION = "v1";
// v1 plus the reset it was issued under: only an account that went through Start fresh gets one.
const RESET_CURSOR_VERSION = "v2";

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
  const position = `${cursor.updatedAt.toISOString()}|${cursor.id ?? ""}`;
  const raw = cursor.resetAt
    ? `${RESET_CURSOR_VERSION}|${position}|${cursor.resetAt.toISOString()}`
    : `${CURSOR_VERSION}|${position}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

const parseInstant = (value: string): Date => {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? invalidCursor() : instant;
};

/** Opaque to the client; a malformed one is a 400, never a silent page one. */
export function decodeCursor(raw: string): ChangeCursor {
  const parts = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const [version, updatedAt, id, resetAt] = parts;
  if (version === CURSOR_VERSION && parts.length === 3) {
    return {
      updatedAt: parseInstant(updatedAt as string),
      id: id || null,
      resetAt: null,
    };
  }
  if (version === RESET_CURSOR_VERSION && parts.length === 4) {
    return {
      updatedAt: parseInstant(updatedAt as string),
      id: id || null,
      resetAt: parseInstant(resetAt as string),
    };
  }
  return invalidCursor();
}

// A `?since=` cannot name its copy, so it is only trusted when it starts after the last reset.
export function cursorFitsReset(
  cursor: ChangeCursor,
  dataResetAt: Date | null,
): boolean {
  if (cursor.resetAt === undefined) {
    return !dataResetAt || cursor.updatedAt >= dataResetAt;
  }
  return (
    (cursor.resetAt?.getTime() ?? null) === (dataResetAt?.getTime() ?? null)
  );
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
