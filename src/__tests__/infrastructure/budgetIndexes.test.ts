jest.mock("../../shared/constants", () => ({
  MODEL_NAMES: { BUDGET: "Budget" },
  BUDGET_TYPES: { EXPENSE: "EXPENSE", INCOME: "INCOME" },
  BUDGET_PERIOD_TYPES: {
    WEEKLY: "WEEKLY",
    BIWEEKLY: "BIWEEKLY",
    MONTHLY: "MONTHLY",
    QUARTERLY: "QUARTERLY",
    YEARLY: "YEARLY",
    CUSTOM: "CUSTOM",
  },
  COLORS: { RED: "RED", TEAL: "TEAL" },
}));

import { BudgetModel } from "../../infrastructure/models/BudgetModel";

type IndexSpec = [Record<string, number>, Record<string, unknown>?];

// The overlap rule's race protection lives in this index; the suite mocks the
// repositories, so nothing else would notice it losing a key or its filter.
describe("BudgetModel indexes", () => {
  const declared = BudgetModel.schema.indexes() as IndexSpec[];
  const unique = declared.filter(([, opts]) => opts?.unique === true);

  it("declares exactly one unique index, over active budgets only", () => {
    expect(unique).toHaveLength(1);
    expect(unique[0][1]?.partialFilterExpression).toEqual({ archivedAt: null });
  });

  // Recurring budgets store null dates, so their key collapses to the period
  // type as before; a CUSTOM budget collides only with an identical window,
  // leaving intersecting windows to findOverlapping.
  it("keys the no-overlap guarantee by category and CUSTOM window", () => {
    expect(unique[0][0]).toEqual({
      userId: 1,
      type: 1,
      periodType: 1,
      categoryIds: 1,
      periodStartDate: 1,
      periodEndDate: 1,
    });
  });

  it("backs the per-user listing", () => {
    expect(
      declared.find(
        ([k]) =>
          JSON.stringify(k) === JSON.stringify({ userId: 1, archivedAt: 1 }),
      ),
    ).toBeDefined();
  });
});
