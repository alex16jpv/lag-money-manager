import { Request } from "express";

export const SORT_FIELDS = { date: "date", amount: "amount" } as const;
export const SORT_ORDERS = { asc: "asc", desc: "desc" } as const;

export type SortField = keyof typeof SORT_FIELDS;
export type SortOrder = keyof typeof SORT_ORDERS;

export interface PaginationParams {
  limit: number;
  offset: number;
  cursor?: string;
}

/**
 * Only transactions order by anything. The order lives beside the cursor
 * because the cursor is a keyset over `(sort, _id)`: read under another order
 * it continues from the same row down a different list.
 */
export interface TransactionPagination extends PaginationParams {
  sort: SortField;
  order: SortOrder;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// One row past the page: a full page and a full page with more behind are otherwise the same.
export const pageQueryLimit = (limit: number): number => limit + 1;

/** Takes the `pageQueryLimit` rows and hands back the page inside them. */
export function buildPaginatedResult<T extends { id: string }>(
  fetched: T[],
  total: number,
  pagination: PaginationParams,
): PaginatedResult<T> {
  const { limit, offset, cursor } = pagination;
  const effectiveOffset = cursor ? 0 : offset;
  const hasMore = fetched.length > limit;
  const data = hasMore ? fetched.slice(0, limit) : fetched;
  return {
    data,
    pagination: {
      limit,
      offset: effectiveOffset,
      total,
      hasMore,
      nextCursor: hasMore && data.length > 0 ? data[data.length - 1].id : null,
    },
  };
}

export function extractPagination(req: Request): PaginationParams {
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  return {
    limit: Math.min(Math.max(rawLimit || DEFAULT_LIMIT, 1), MAX_LIMIT),
    offset: Math.max(rawOffset || 0, 0),
    cursor: req.query.cursor as string | undefined,
  };
}

// Own keys only: `in` would let "constructor" and "__proto__" through as a sort field.
const oneOf = <T extends string>(
  values: Record<T, string>,
  raw: unknown,
  fallback: T,
): T =>
  typeof raw === "string" && Object.prototype.hasOwnProperty.call(values, raw)
    ? (raw as T)
    : fallback;

/** The single place the listing's default order is decided; the schema refuses anything else. */
export function extractTransactionPagination(
  req: Request,
): TransactionPagination {
  return {
    ...extractPagination(req),
    sort: oneOf(SORT_FIELDS, req.query.sort, "date"),
    order: oneOf(SORT_ORDERS, req.query.order, "desc"),
  };
}
