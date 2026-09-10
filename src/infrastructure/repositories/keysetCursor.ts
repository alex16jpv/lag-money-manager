import { Model } from "mongoose";

import { ApiError } from "../../shared/errors";

/** Silently serving page 1 for a cursor made infinite scroll duplicate items. */
export const invalidCursor = (): ApiError =>
  new ApiError("BadRequest", "Invalid pagination cursor", "INVALID_CURSOR");

export const ID_CURSOR_SORT = { _id: 1 } as const;

/**
 * The `_id` keyset filter that continues a page. The cursor has to name a row
 * of the owner's: scoped so a foreign id cannot act as a pivot (id oracle),
 * and refused when it names none — the query schema only checks the shape, so
 * a well-formed id would otherwise serve whatever `_id > it` matched, which is
 * the whole list for any id that sorts first. The `$gt` merges into an ids
 * (`$in`) filter instead of clobbering it.
 */
export async function idCursorFilter<T>(
  model: Model<T>,
  baseFilter: Record<string, unknown>,
  cursor: string,
): Promise<Record<string, unknown>> {
  const owner = baseFilter.userId;
  const pivot = await model
    .findOne({
      _id: cursor,
      ...(typeof owner === "string" ? { userId: owner } : {}),
    } as never)
    .select("_id")
    .lean();
  if (!pivot) throw invalidCursor();

  const filter = { ...baseFilter };
  filter._id =
    filter._id && typeof filter._id === "object"
      ? { ...(filter._id as Record<string, unknown>), $gt: cursor }
      : { $gt: cursor };
  return filter;
}
