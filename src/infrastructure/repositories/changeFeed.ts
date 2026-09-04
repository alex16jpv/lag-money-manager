import { ChangeCursor } from "../../shared/syncCursor";

/**
 * Keyset predicate over `(updatedAt, _id)` for the offline change feed. Both
 * branches of the `$or` stay prefixed by `userId`, so each is answered by
 * `(userId, updatedAt, _id)` already sorted and MongoDB merges them instead of
 * sorting the result in memory.
 */
export function changesSinceFilter(
  userId: string,
  cursor?: ChangeCursor,
): Record<string, unknown> {
  if (!cursor) return { userId };
  if (!cursor.id) return { userId, updatedAt: { $gt: cursor.updatedAt } };
  return {
    userId,
    $or: [
      { updatedAt: { $gt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, _id: { $gt: cursor.id } },
    ],
  };
}

export const CHANGE_FEED_SORT = { updatedAt: 1, _id: 1 } as const;
