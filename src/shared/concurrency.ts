import { ApiError, StaleUpdateError } from "./errors";

export interface Versioned {
  updatedAt?: Date;
}

export const sameVersion = (
  stored: Date | undefined,
  expected: Date,
): boolean => stored?.getTime() === expected.getTime();

const isNotFound = (err: unknown): boolean =>
  err instanceof ApiError && err.statusCode === 404;

/** 409 when the caller's `If-Match` no longer matches what is stored. */
export function assertFresh<S extends Versioned>(
  stored: S,
  expected: Date | undefined,
  present: (stored: S) => unknown,
): void {
  if (expected && !sameVersion(stored.updatedAt, expected)) {
    throw new StaleUpdateError(present(stored));
  }
}

/**
 * Runs a write whose own filter carries the version guard — the check callers
 * do beforehand cannot be atomic on its own. A filter that matches nothing
 * means the resource is gone *or* somebody wrote it in between; only a re-read
 * tells them apart.
 */
export async function guardedWrite<T, S extends Versioned>(
  expected: Date | undefined,
  write: () => Promise<T>,
  reread: () => Promise<S | null>,
  present: (stored: S) => Promise<unknown> | unknown,
): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (!expected || !isNotFound(err)) throw err;
    const current = await reread();
    if (current && !sameVersion(current.updatedAt, expected)) {
      throw new StaleUpdateError(await present(current));
    }
    throw err;
  }
}
