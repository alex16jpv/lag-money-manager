import { Request } from "express";

import {
  buildPaginatedResult,
  DEFAULT_LIMIT,
  extractPagination,
  extractTransactionPagination,
  MAX_LIMIT,
  pageQueryLimit,
  PaginationParams,
  TransactionPagination,
} from "../../shared/pagination";

const rows = (n: number): { id: string }[] =>
  Array.from({ length: n }, (_, i) => ({ id: `row-${i + 1}` }));

const params = (over: Partial<PaginationParams> = {}): PaginationParams => ({
  limit: 2,
  offset: 0,
  ...over,
});

// The repositories ask for one row past the page; this is what reads it.
describe("buildPaginatedResult", () => {
  it("asks for one row past the page", () => {
    expect(pageQueryLimit(20)).toBe(21);
  });

  it("trims the probe row and promises more", () => {
    const page = buildPaginatedResult(rows(3), 9, params());

    expect(page.data.map((r) => r.id)).toEqual(["row-1", "row-2"]);
    expect(page.pagination).toEqual({
      limit: 2,
      offset: 0,
      total: 9,
      hasMore: true,
      // The last row OF THE PAGE, never the probe: a cursor on a row the caller never saw skips it.
      nextCursor: "row-2",
    });
  });

  // `data.length === limit` called an exactly-full last page "there is more".
  it("does not promise more when the last page is exactly full", () => {
    const page = buildPaginatedResult(rows(2), 2, params({ cursor: "row-0" }));

    expect(page.data).toHaveLength(2);
    expect(page.pagination).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("answers an empty page without a cursor to follow", () => {
    const page = buildPaginatedResult([], 4, params({ offset: 99 }));

    expect(page.data).toEqual([]);
    expect(page.pagination).toMatchObject({
      hasMore: false,
      nextCursor: null,
      offset: 99,
      total: 4,
    });
  });

  it("reports a cursor page's offset as zero, whatever was sent", () => {
    const page = buildPaginatedResult(
      rows(1),
      4,
      params({ cursor: "row-0", offset: 40 }),
    );

    expect(page.pagination.offset).toBe(0);
  });

  it("keeps the offset of an offset page", () => {
    const page = buildPaginatedResult(rows(1), 4, params({ offset: 3 }));

    expect(page.pagination).toMatchObject({ offset: 3, hasMore: false });
  });

  it("counts the whole filtered set, not the page", () => {
    expect(buildPaginatedResult(rows(1), 87, params()).pagination.total).toBe(
      87,
    );
  });
});

describe("extractPagination", () => {
  const from = (query: Record<string, unknown>): PaginationParams =>
    extractPagination({ query } as unknown as Request);

  it("falls back to the default limit and no offset", () => {
    expect(from({})).toEqual({
      limit: DEFAULT_LIMIT,
      offset: 0,
      cursor: undefined,
    });
  });

  // Only transactions order by anything: the generic paginator must not grow a field they ignore.
  it("says nothing about an order the other listings do not have", () => {
    expect(from({ sort: "amount", order: "asc" })).not.toHaveProperty("sort");
  });

  it("clamps the limit to the ceiling and to one", () => {
    expect(from({ limit: "5000" }).limit).toBe(MAX_LIMIT);
    expect(from({ limit: "0" }).limit).toBe(DEFAULT_LIMIT);
    expect(from({ limit: "-3" }).limit).toBe(1);
  });

  it("never lets the offset go negative", () => {
    expect(from({ offset: "-10" }).offset).toBe(0);
  });

  it("carries the cursor through", () => {
    expect(from({ cursor: "row-7" }).cursor).toBe("row-7");
  });
});

describe("extractTransactionPagination", () => {
  const from = (query: Record<string, unknown>): TransactionPagination =>
    extractTransactionPagination({ query } as unknown as Request);

  it("reads the order the page runs in, beside its cursor", () => {
    expect(from({ sort: "amount", order: "asc", cursor: "row-7" })).toEqual({
      limit: DEFAULT_LIMIT,
      offset: 0,
      cursor: "row-7",
      sort: "amount",
      order: "asc",
    });
  });

  // The route's schema refuses anything else, so a value that got this far falls back.
  it.each([
    ["a field it does not order by", { sort: "description" }],
    ["nothing at all", {}],
    ["the right word in the wrong case", { sort: "AMOUNT" }],
    ["the parameter twice, which arrives as an array", { sort: ["amount"] }],
    ["a key every object inherits", { sort: "constructor" }],
    ["the prototype itself", { sort: "__proto__" }],
    ["an inherited method on the direction", { order: "hasOwnProperty" }],
  ])("falls back to newest first given %s", (_label, query) => {
    expect(from(query)).toMatchObject({ sort: "date", order: "desc" });
  });
});
