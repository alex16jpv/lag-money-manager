jest.mock("../../shared/constants", () => ({
  MODEL_NAMES: { TRANSACTION: "Transaction" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
    ADJUSTMENT: "ADJUSTMENT",
  },
  TRANSACTION_SOURCES: { MANUAL: "MANUAL", QUICK: "QUICK", IMPORT: "IMPORT" },
}));

import { TransactionModel } from "../../infrastructure/models/TransactionModel";

type IndexSpec = [Record<string, number>, Record<string, unknown>?];

// Indexes are correctness and cost, not decoration, and the suite mocks the
// repositories — nothing else here would notice one disappearing.
describe("TransactionModel indexes", () => {
  const declared = TransactionModel.schema.indexes() as IndexSpec[];

  const has = (keys: Record<string, number>): IndexSpec | undefined =>
    declared.find(([k]) => JSON.stringify(k) === JSON.stringify(keys));

  it("backs the primary listing sort, count included", () => {
    expect(has({ userId: 1, deletedAt: 1, date: -1, _id: -1 })).toBeDefined();
  });

  it.each([
    ["category drill-down", { userId: 1, categoryId: 1, date: -1 }],
    ["tag filter", { userId: 1, tags: 1, date: -1 }],
    ["accountId $or branch (from)", { userId: 1, fromAccountId: 1, date: -1 }],
    ["accountId $or branch (to)", { userId: 1, toAccountId: 1, date: -1 }],
  ])("backs the %s", (_label, keys) => {
    expect(has(keys as Record<string, number>)).toBeDefined();
  });

  // Measured over 50k transactions: without it the filter sheet's count
  // fetches every live document (45 ms) instead of reading the index (1 ms).
  it("backs the source filter so its count stays index-only", () => {
    expect(has({ userId: 1, deletedAt: 1, source: 1, date: -1 })).toBeDefined();
  });

  it("backs the review inbox with a partial index over pending rows only", () => {
    const found = has({ userId: 1, date: -1 });
    expect(found).toBeDefined();
    expect(found?.[1]?.partialFilterExpression).toEqual({
      pendingDetails: true,
      deletedAt: null,
    });
  });
});
