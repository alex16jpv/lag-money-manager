jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: { NODE_ENV: "test" },
  DB_TYPES: { MONGO: "MONGO" },
  COLORS: { RED: "RED", TEAL: "TEAL" },
  BUDGET_PERIOD_TYPES: {
    WEEKLY: "WEEKLY",
    BIWEEKLY: "BIWEEKLY",
    MONTHLY: "MONTHLY",
    QUARTERLY: "QUARTERLY",
    YEARLY: "YEARLY",
    CUSTOM: "CUSTOM",
  },
  MODEL_NAMES: { BUDGET: "Budget" },
}));

import { BudgetService } from "../../app/services/BudgetService";
import { Budget } from "../../domain/entities/Budget";
import { IBudgetRepository } from "../../domain/repositories/budget/IBudgetRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";

const USER = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const CTX = { reference: new Date("2026-08-15T12:00:00Z"), timezone: "America/Bogota" };

const createBudgetRepo = (): jest.Mocked<IBudgetRepository> =>
  ({
    getAll: jest.fn(),
    getAllByUserId: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    restore: jest.fn(),
    findOverlapping: jest.fn().mockResolvedValue([]),
    setAmountOverride: jest.fn(),
  }) as unknown as jest.Mocked<IBudgetRepository>;

const createTxRepo = (): jest.Mocked<ITransactionRepository> =>
  ({
    sumExpensesByCategory: jest.fn().mockResolvedValue({}),
  }) as unknown as jest.Mocked<ITransactionRepository>;

const makeBudget = (over: Partial<Budget> = {}): Budget =>
  new Budget({
    id: "b1",
    name: "Food",
    color: "RED",
    categoryIds: ["c1"],
    amount: 100,
    periodType: "MONTHLY",
    userId: USER,
    ...over,
  });

describe("BudgetService", () => {
  let service: BudgetService;
  let budgetRepo: jest.Mocked<IBudgetRepository>;
  let txRepo: jest.Mocked<ITransactionRepository>;

  beforeEach(() => {
    budgetRepo = createBudgetRepo();
    txRepo = createTxRepo();
    service = new BudgetService(budgetRepo, txRepo);
  });

  it("computes spent for the reference period", async () => {
    budgetRepo.getAllByUserId.mockResolvedValue({
      data: [makeBudget()],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextCursor: null },
    });
    txRepo.sumExpensesByCategory.mockResolvedValue({ c1: 4200 }); // cents

    const res = await service.getBudgets(USER, { limit: 20, offset: 0 }, {}, CTX);

    expect(res.data[0].spent).toBe(42);
    expect(res.data[0].amount).toBe(100);
    expect(res.data[0].periodKey).toBe("2026-08");
  });

  it("uses the per-period override for amount when present", async () => {
    budgetRepo.getAllByUserId.mockResolvedValue({
      data: [makeBudget({ amountOverrides: { "2026-08": 150 } })],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextCursor: null },
    });
    txRepo.sumExpensesByCategory.mockResolvedValue({ c1: 1000 });

    const res = await service.getBudgets(USER, { limit: 20, offset: 0 }, {}, CTX);
    expect(res.data[0].amount).toBe(150);
  });

  it("rejects creating a duplicate budget (same category + period type)", async () => {
    budgetRepo.findOverlapping.mockResolvedValue([makeBudget()]);

    await expect(
      service.createBudget(
        {
          name: "Food 2",
          color: "TEAL",
          categoryIds: ["c1"],
          amount: 50,
          periodType: "MONTHLY",
          userId: USER,
        },
        CTX,
      ),
    ).rejects.toThrow("already exists");
    expect(budgetRepo.create).not.toHaveBeenCalled();
  });

  it("requires start/end dates for a custom period", async () => {
    await expect(
      service.createBudget(
        {
          name: "Trip",
          color: "RED",
          categoryIds: ["c1"],
          amount: 50,
          periodType: "CUSTOM",
          userId: USER,
        },
        CTX,
      ),
    ).rejects.toThrow("Custom period requires");
  });
});
