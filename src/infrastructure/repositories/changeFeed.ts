import { ChangeCursor } from "../../shared/syncCursor";

/**
 * Keyset predicate over `(updatedAt, _id)` for the offline change feed. Both
 * branches of the `$or` stay prefixed by the owner field (`userId`, or what a
 * shared row is found by), so each is answered by `(owner, updatedAt, _id)`
 * already sorted and MongoDB merges them instead of sorting in memory.
 */
export function changesSinceFilter(
  owner: string | { $in: string[] },
  cursor?: ChangeCursor,
  ownerField = "userId",
): Record<string, unknown> {
  const scope = { [ownerField]: owner };
  if (!cursor) return scope;
  if (!cursor.id) return { ...scope, updatedAt: { $gt: cursor.updatedAt } };
  return {
    ...scope,
    $or: [
      { updatedAt: { $gt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, _id: { $gt: cursor.id } },
    ],
  };
}

export const CHANGE_FEED_SORT = { updatedAt: 1, _id: 1 } as const;
