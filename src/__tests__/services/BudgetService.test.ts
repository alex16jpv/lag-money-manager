jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: { NODE_ENV: "test" },
  DB_TYPES: { MONGO: "MONGO" },
  COLORS: { RED: "RED", TEAL: "TEAL" },
  BUDGET_TYPES: { EXPENSE: "EXPENSE", INCOME: "INCOME" },
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
import { Category } from "../../domain/entities/Category";
import { IBudgetRepository } from "../../domain/repositories/budget/IBudgetRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
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
    findOverlapping: jest.fn().mockResolvedValue([]),
    setAmountOverride: jest.fn(),
    clearAmountOverride: jest.fn(),
  }) as unknown as jest.Mocked<IBudgetRepository>;

const createTxRepo = (): jest.Mocked<ITransactionRepository> =>
  ({
    sumAmountsByCategory: jest.fn().mockResolvedValue({}),
    sumAmounts: jest.fn().mockResolvedValue(0),
  }) as unknown as jest.Mocked<ITransactionRepository>;

const createCategoryRepo = (): jest.Mocked<ICategoryRepository> =>
  ({
    // Default: every referenced category exists, is the user's, and is active.
    getByIdIncludingArchived: jest
      .fn()
      .mockImplementation(async (id: string) =>
        new Category({ id, name: "Cat", userId: USER }),
      ),
    listArchivedIds: jest.fn().mockResolvedValue([]),
  }) as unknown as jest.Mocked<ICategoryRepository>;

const makeBudget = (over: Partial<Budget> = {}): Budget =>
  new Budget({
    id: "b1",
    name: "Food",
    color: "RED",
    categoryIds: ["c1"],
    amount: 100,
    periodType: "MONTHLY",
    userId: USER,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  });

describe("BudgetService", () => {
  let service: BudgetService;
  let budgetRepo: jest.Mocked<IBudgetRepository>;
  let txRepo: jest.Mocked<ITransactionRepository>;
  let categoryRepo: jest.Mocked<ICategoryRepository>;

  beforeEach(() => {
    budgetRepo = createBudgetRepo();
    txRepo = createTxRepo();
    categoryRepo = createCategoryRepo();
    service = new BudgetService(budgetRepo, txRepo, categoryRepo);
  });

  it("computes spent for the reference period", async () => {
    budgetRepo.getAllByUserId.mockResolvedValue({
      data: [makeBudget()],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextCursor: null },
    });
    txRepo.sumAmountsByCategory.mockResolvedValue({ c1: 4200 }); // cents

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
    txRepo.sumAmountsByCategory.mockResolvedValue({ c1: 1000 });

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

  describe("category validation [R2-12]", () => {
    it("rejects a budget over a foreign or nonexistent category", async () => {
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(
        service.createBudget(
          {
            name: "Food",
            color: "RED",
            categoryIds: ["c-nope"],
            amount: 100,
            periodType: "MONTHLY",
            userId: USER,
          },
          CTX,
        ),
      ).rejects.toThrow("Category not found");
      expect(budgetRepo.create).not.toHaveBeenCalled();
    });

    it("rejects assigning an archived category", async () => {
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({
          id: "c1",
          name: "Cat",
          userId: USER,
          archivedAt: new Date(),
        }),
      );

      await expect(
        service.createBudget(
          {
            name: "Food",
            color: "RED",
            categoryIds: ["c1"],
            amount: 100,
            periodType: "MONTHLY",
            userId: USER,
          },
          CTX,
        ),
      ).rejects.toThrow("Category is archived");
    });

    it("keeps an archived category on update when it was already on the budget", async () => {
      const existing = makeBudget();
      budgetRepo.getById.mockResolvedValue(existing);
      budgetRepo.update.mockResolvedValue(existing);
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({
          id: "c1",
          name: "Cat",
          userId: USER,
          archivedAt: new Date(),
        }),
      );

      await expect(
        service.updateBudget("b1", { categoryIds: ["c1"] }, USER, CTX),
      ).resolves.toBeDefined();
    });
  });

  describe("global budget [R2-13]", () => {
    it("computes spent as the window's TOTAL expense (quick-adds included)", async () => {
      const globalBudget = makeBudget({ id: "bg", categoryIds: [] });
      budgetRepo.getAllByUserId.mockResolvedValue({
        data: [globalBudget],
        pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextCursor: null },
      });
      txRepo.sumAmounts.mockResolvedValue(12550);

      const result = await service.getBudgets(USER, { limit: 20, offset: 0 }, {}, CTX);

      expect(result.data[0].spent).toBe(125.5);
      expect(txRepo.sumAmounts).toHaveBeenCalled();
      expect(txRepo.sumAmountsByCategory).not.toHaveBeenCalled();
    });

    it("rejects a second global budget for the same period type", async () => {
      budgetRepo.findOverlapping.mockResolvedValue([
        makeBudget({ id: "bg", categoryIds: [] }),
      ]);

      await expect(
        service.createBudget(
          {
            name: "Total 2",
            color: "RED",
            categoryIds: [],
            amount: 900,
            periodType: "MONTHLY",
            userId: USER,
          },
          CTX,
        ),
      ).rejects.toThrow("already exists");
    });
  });

  describe("effectiveFrom [R2-16a]", () => {
    const list = (budgets: Budget[]) =>
      budgetRepo.getAllByUserId.mockResolvedValue({
        data: budgets,
        pagination: { limit: 20, offset: 0, total: budgets.length, hasMore: false, nextCursor: null },
      });

    it("hides a budget for references before it existed", async () => {
      // Created in October; reference (CTX) is August.
      list([makeBudget({ createdAt: new Date("2026-10-05T00:00:00Z") })]);

      const result = await service.getBudgets(USER, { limit: 20, offset: 0 }, {}, CTX);

      expect(result.data).toHaveLength(0);
    });

    it("a backdated effectiveFrom overrides createdAt", async () => {
      list([
        makeBudget({
          createdAt: new Date("2026-10-05T00:00:00Z"),
          effectiveFrom: new Date("2026-07-01T00:00:00Z"),
        }),
      ]);

      const result = await service.getBudgets(USER, { limit: 20, offset: 0 }, {}, CTX);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].effectiveFrom.toISOString()).toBe(
        "2026-07-01T00:00:00.000Z",
      );
    });

    it("shows the partial first window (created mid-period)", async () => {
      // Created Aug 20; the August window still lists (full-month spend).
      list([makeBudget({ createdAt: new Date("2026-08-20T00:00:00Z") })]);

      const result = await service.getBudgets(USER, { limit: 20, offset: 0 }, {}, CTX);

      expect(result.data).toHaveLength(1);
    });
  });

  describe("override management [R2-16b]", () => {
    it("exposes hasOverride and resolves a 0 override", async () => {
      const b = makeBudget({ amountOverrides: { "2026-08": 0 } });
      budgetRepo.getAllByUserId.mockResolvedValue({
        data: [b],
        pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextCursor: null },
      });

      const result = await service.getBudgets(USER, { limit: 20, offset: 0 }, {}, CTX);

      expect(result.data[0].hasOverride).toBe(true);
      expect(result.data[0].amount).toBe(0);
      expect(result.data[0].baseAmount).toBe(100);
    });

    it("clears the override for the reference period", async () => {
      const b = makeBudget();
      budgetRepo.getById.mockResolvedValue(b);
      budgetRepo.clearAmountOverride.mockResolvedValue(b);

      const view = await service.clearAmountOverride("b1", USER, CTX);

      expect(budgetRepo.clearAmountOverride).toHaveBeenCalledWith(
        "b1",
        USER,
        "2026-08",
      );
      expect(view.hasOverride).toBe(false);
    });

    it("prunes overrides and CUSTOM dates when the period type changes", async () => {
      const b = makeBudget({
        periodType: "CUSTOM",
        periodStartDate: new Date("2026-08-01T00:00:00Z"),
        periodEndDate: new Date("2026-09-01T00:00:00Z"),
        amountOverrides: { "1754006400000_1756684800000": 50 },
      });
      budgetRepo.getById.mockResolvedValue(b);
      budgetRepo.update.mockResolvedValue(makeBudget());

      await service.updateBudget("b1", { periodType: "MONTHLY" }, USER, CTX);

      const patch = budgetRepo.update.mock.calls[0][1];
      expect(patch.amountOverrides).toEqual({});
      expect(patch.periodStartDate).toBeNull();
      expect(patch.periodEndDate).toBeNull();
    });

    it("rejects CUSTOM dates on a non-CUSTOM budget", async () => {
      await expect(
        service.createBudget(
          {
            name: "Bad",
            color: "RED",
            categoryIds: ["c1"],
            amount: 100,
            periodType: "MONTHLY",
            periodStartDate: new Date("2026-08-01T00:00:00Z"),
            userId: USER,
          },
          CTX,
        ),
      ).rejects.toThrow("only allowed for CUSTOM");
    });
  });

  describe("budget type [R2-16c]", () => {
    it("an INCOME budget sums INCOME amounts", async () => {
      const goal = makeBudget({ id: "bi", type: "INCOME", categoryIds: [] });
      budgetRepo.getAllByUserId.mockResolvedValue({
        data: [goal],
        pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextCursor: null },
      });
      txRepo.sumAmounts.mockResolvedValue(200000);

      const result = await service.getBudgets(USER, { limit: 20, offset: 0 }, {}, CTX);

      expect(txRepo.sumAmounts).toHaveBeenCalledWith(
        USER,
        expect.any(Date),
        expect.any(Date),
        "INCOME",
      );
      expect(result.data[0].type).toBe("INCOME");
      expect(result.data[0].spent).toBe(2000);
    });

    it("EXPENSE and INCOME budgets over the same category do not overlap", async () => {
      budgetRepo.findOverlapping.mockResolvedValue([]);
      budgetRepo.create.mockImplementation(async (b) => new Budget(b as Budget));

      await service.createBudget(
        {
          name: "Meta Salary",
          color: "TEAL",
          categoryIds: ["c1"],
          type: "INCOME",
          amount: 5000,
          periodType: "MONTHLY",
          userId: USER,
        },
        CTX,
      );

      expect(budgetRepo.findOverlapping).toHaveBeenCalledWith(
        USER,
        "INCOME",
        "MONTHLY",
        ["c1"],
        undefined,
      );
    });

    it("rejects a category whose type contradicts the budget type", async () => {
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({ id: "c1", name: "Salary", type: "INCOME", userId: USER }),
      );

      await expect(
        service.createBudget(
          {
            name: "Gasto salario",
            color: "RED",
            categoryIds: ["c1"],
            amount: 100,
            periodType: "MONTHLY",
            userId: USER,
          },
          CTX,
        ),
      ).rejects.toThrow("does not match budget type");
    });
  });
});
