import { Request } from "express";

export interface PaginationParams {
  limit: number;
  offset: number;
  cursor?: string;
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

export function buildPaginatedResult<T extends { id: string }>(
  data: T[],
  total: number,
  pagination: PaginationParams,
): PaginatedResult<T> {
  const { limit, offset, cursor } = pagination;
  const effectiveOffset = cursor ? 0 : offset;
  const hasMore = cursor
    ? data.length === limit
    : effectiveOffset + data.length < total;
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
