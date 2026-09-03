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
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";

const USER = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const CTX = {
  reference: new Date("2026-08-15T12:00:00Z"),
  timezone: "America/Bogota",
};

const createBudgetRepo = (): jest.Mocked<IBudgetRepository> =>
  ({
    getAll: jest.fn(),
    getAllByUserId: jest.fn(),
    getById: jest.fn(),
    getByIdIncludingArchived: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findOverlapping: jest.fn().mockResolvedValue([]),
    setAmountOverride: jest.fn(),
    clearAmountOverride: jest.fn(),
    restore: jest.fn(),
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
      .mockImplementation(
        async (id: string) => new Category({ id, name: "Cat", userId: USER }),
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

const createUserRepo = () =>
  ({
    getById: jest.fn().mockResolvedValue({ id: USER, currency: "COP" }),
  }) as unknown as jest.Mocked<IUserRepository>;

describe("BudgetService", () => {
  let service: BudgetService;
  let budgetRepo: jest.Mocked<IBudgetRepository>;
  let txRepo: jest.Mocked<ITransactionRepository>;
  let categoryRepo: jest.Mocked<ICategoryRepository>;
  let userRepo: jest.Mocked<IUserRepository>;

  beforeEach(() => {
    budgetRepo = createBudgetRepo();
    txRepo = createTxRepo();
    categoryRepo = createCategoryRepo();
    userRepo = createUserRepo();
    service = new BudgetService(budgetRepo, txRepo, categoryRepo, userRepo);
  });

  it("computes spent for the reference period", async () => {
    budgetRepo.getAllByUserId.mockResolvedValue({
      data: [makeBudget()],
      pagination: {
        limit: 20,
        offset: 0,
        total: 1,
        hasMore: false,
        nextCursor: null,
      },
    });
    txRepo.sumAmountsByCategory.mockResolvedValue({ c1: 4200 }); // cents

    const res = await service.getBudgets(
      USER,
      { limit: 20, offset: 0 },
      {},
      CTX,
    );

    expect(res.data[0].spent).toBe(42);
    expect(res.data[0].amount).toBe(100);
    expect(res.data[0].periodKey).toBe("2026-08");
  });

  it("uses the per-period override for amount when present", async () => {
    budgetRepo.getAllByUserId.mockResolvedValue({
      data: [makeBudget({ amountOverrides: { "2026-08": 150 } })],
      pagination: {
        limit: 20,
        offset: 0,
        total: 1,
        hasMore: false,
        nextCursor: null,
      },
    });
    txRepo.sumAmountsByCategory.mockResolvedValue({ c1: 1000 });

    const res = await service.getBudgets(
      USER,
      { limit: 20, offset: 0 },
      {},
      CTX,
    );
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

  it("stamps the owner's currency on the budget [multi-moneda etapa 1]", async () => {
    budgetRepo.create.mockImplementation(async (b) => new Budget(b as Budget));

    await service.createBudget(
      {
        name: "Food",
        color: "RED",
        categoryIds: ["c1"],
        amount: 100,
        periodType: "MONTHLY",
        userId: USER,
      },
      CTX,
    );

    const created = budgetRepo.create.mock.calls[0][0];
    expect((created as Budget).currency).toBe("COP");
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
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(existing);
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
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });
      txRepo.sumAmounts.mockResolvedValue(12550);

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        {},
        CTX,
      );

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
        pagination: {
          limit: 20,
          offset: 0,
          total: budgets.length,
          hasMore: false,
          nextCursor: null,
        },
      });

    it("hides a budget for references before it existed", async () => {
      // Created in October; reference (CTX) is August.
      list([makeBudget({ createdAt: new Date("2026-10-05T00:00:00Z") })]);

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        {},
        CTX,
      );

      expect(result.data).toHaveLength(0);
    });

    it("a backdated effectiveFrom overrides createdAt", async () => {
      list([
        makeBudget({
          createdAt: new Date("2026-10-05T00:00:00Z"),
          effectiveFrom: new Date("2026-07-01T00:00:00Z"),
        }),
      ]);

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        {},
        CTX,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].effectiveFrom.toISOString()).toBe(
        "2026-07-01T00:00:00.000Z",
      );
    });

    it("shows the partial first window (created mid-period)", async () => {
      // Created Aug 20; the August window still lists (full-month spend).
      list([makeBudget({ createdAt: new Date("2026-08-20T00:00:00Z") })]);

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        {},
        CTX,
      );

      expect(result.data).toHaveLength(1);
    });
  });

  describe("override management [R2-16b]", () => {
    it("exposes hasOverride and resolves a 0 override", async () => {
      const b = makeBudget({ amountOverrides: { "2026-08": 0 } });
      budgetRepo.getAllByUserId.mockResolvedValue({
        data: [b],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        {},
        CTX,
      );

      expect(result.data[0].hasOverride).toBe(true);
      expect(result.data[0].amount).toBe(0);
      expect(result.data[0].baseAmount).toBe(100);
    });

    it("clears the override for the reference period", async () => {
      const b = makeBudget();
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(b);
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
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(b);
      budgetRepo.update.mockResolvedValue(makeBudget());

      await service.updateBudget("b1", { periodType: "MONTHLY" }, USER, CTX);

      const patch = budgetRepo.update.mock.calls[0][1];
      expect(patch.amountOverrides).toEqual({});
      expect(patch.periodStartDate).toBeNull();
      expect(patch.periodEndDate).toBeNull();
    });

    it("prunes overrides when the CUSTOM window dates move", async () => {
      const b = makeBudget({
        periodType: "CUSTOM",
        periodStartDate: new Date("2026-08-01T00:00:00Z"),
        periodEndDate: new Date("2026-09-01T00:00:00Z"),
        amountOverrides: { "1754006400000_1756684800000": 50 },
      });
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(b);
      budgetRepo.update.mockResolvedValue(makeBudget());

      await service.updateBudget(
        "b1",
        { periodEndDate: new Date("2026-09-15T00:00:00Z") },
        USER,
        CTX,
      );

      expect(budgetRepo.update.mock.calls[0][1].amountOverrides).toEqual({});
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
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });
      txRepo.sumAmounts.mockResolvedValue(200000);

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        {},
        CTX,
      );

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
      budgetRepo.create.mockImplementation(
        async (b) => new Budget(b as Budget),
      );

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
        expect.objectContaining({
          type: "INCOME",
          periodType: "MONTHLY",
          categoryIds: ["c1"],
        }),
        undefined,
      );
    });

    it("rejects a category whose type contradicts the budget type", async () => {
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({
          id: "c1",
          name: "Salary",
          type: "INCOME",
          userId: USER,
        }),
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

  // W-28: two CUSTOM budgets over one category coexist unless their windows
  // intersect. The intersection itself is the repository's query; the service
  // must hand it the candidate window and word the refusal accordingly.
  describe("CUSTOM overlap by dates [W-28]", () => {
    const window = {
      periodStartDate: new Date("2026-12-01T00:00:00Z"),
      periodEndDate: new Date("2026-12-31T00:00:00Z"),
    };
    const custom = {
      name: "Vacation December",
      color: "TEAL" as const,
      categoryIds: ["c1"],
      amount: 500,
      periodType: "CUSTOM" as const,
      userId: USER,
      ...window,
    };

    it("creates a second CUSTOM budget for the category when the repo finds no intersecting window", async () => {
      budgetRepo.create.mockImplementation(
        async (b) => new Budget(b as Budget),
      );
      const view = await service.createBudget(custom, CTX);
      expect(view.periodType).toBe("CUSTOM");
      expect(budgetRepo.findOverlapping).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({
          type: "EXPENSE",
          periodType: "CUSTOM",
          categoryIds: ["c1"],
          ...window,
        }),
        undefined,
      );
    });

    it("refuses an intersecting CUSTOM window with BUDGET_PERIOD_OVERLAP", async () => {
      budgetRepo.findOverlapping.mockResolvedValue([
        makeBudget({ id: "july", periodType: "CUSTOM" }),
      ]);
      await expect(service.createBudget(custom, CTX)).rejects.toMatchObject({
        code: "BUDGET_PERIOD_OVERLAP",
        message:
          "A budget for this category already covers part of these dates",
      });
      expect(budgetRepo.create).not.toHaveBeenCalled();
    });

    it("checks the moved window, not the stored one, when a CUSTOM budget is updated", async () => {
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(
        makeBudget({
          periodType: "CUSTOM",
          periodStartDate: new Date("2026-08-01T00:00:00Z"),
          periodEndDate: new Date("2026-09-01T00:00:00Z"),
        }),
      );
      budgetRepo.update.mockResolvedValue(makeBudget());
      const periodEndDate = new Date("2026-09-15T00:00:00Z");
      await service.updateBudget("b1", { periodEndDate }, USER, CTX);
      expect(budgetRepo.findOverlapping).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({
          periodStartDate: new Date("2026-08-01T00:00:00Z"),
          periodEndDate,
        }),
        "b1",
      );
    });

    it("keeps the recurring wording for recurring period types", async () => {
      budgetRepo.findOverlapping.mockResolvedValue([makeBudget()]);
      await expect(
        service.createBudget(
          {
            ...custom,
            periodType: "MONTHLY",
            periodStartDate: null,
            periodEndDate: null,
          },
          CTX,
        ),
      ).rejects.toThrow(
        "A budget for this category and period type already exists",
      );
    });
  });

  describe("CUSTOM expiry [R2-17a]", () => {
    const expiredCustom = () =>
      makeBudget({
        id: "bc",
        periodType: "CUSTOM",
        periodStartDate: new Date("2026-06-01T00:00:00Z"),
        periodEndDate: new Date("2026-07-01T00:00:00Z"),
        createdAt: new Date("2026-05-20T00:00:00Z"),
      });
    const list = (budgets: Budget[]) =>
      budgetRepo.getAllByUserId.mockResolvedValue({
        data: budgets,
        pagination: {
          limit: 20,
          offset: 0,
          total: budgets.length,
          hasMore: false,
          nextCursor: null,
        },
      });

    it("hides an expired CUSTOM budget from the default listing", async () => {
      list([expiredCustom(), makeBudget()]);

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        {},
        CTX,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].periodType).toBe("MONTHLY");
      expect(result.data[0].expired).toBe(false);
    });

    it("lists it flagged when includeExpired=true", async () => {
      list([expiredCustom()]);

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        { includeExpired: true },
        CTX,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].expired).toBe(true);
    });

    it("a CUSTOM budget backdated before its creation still lists (retro window)", async () => {
      list([
        makeBudget({
          id: "bc3",
          periodType: "CUSTOM",
          periodStartDate: new Date("2026-07-01T00:00:00Z"),
          periodEndDate: new Date("2026-08-01T00:00:00Z"),
          // Created AFTER the window it describes: the explicit window wins.
          createdAt: new Date("2026-08-10T00:00:00Z"),
        }),
      ]);

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        { includeExpired: true },
        CTX,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].expired).toBe(true);
    });

    it("a live CUSTOM budget lists normally", async () => {
      list([
        makeBudget({
          id: "bc2",
          periodType: "CUSTOM",
          periodStartDate: new Date("2026-08-01T00:00:00Z"),
          periodEndDate: new Date("2026-09-01T00:00:00Z"),
        }),
      ]);

      const result = await service.getBudgets(
        USER,
        { limit: 20, offset: 0 },
        {},
        CTX,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].expired).toBe(false);
    });
  });
  describe("uniform archive semantics [rev-final]", () => {
    it("an archived budget stays readable by id", async () => {
      const archived = makeBudget({ archivedAt: new Date("2026-08-01") });
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(archived);

      const view = await service.getBudgetById("b1", USER, CTX);

      expect(view.archivedAt).toEqual(archived.archivedAt);
    });

    it("deleting an already-archived budget is an idempotent no-op", async () => {
      const archived = makeBudget({ archivedAt: new Date("2026-08-01") });
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(archived);

      await expect(service.deleteBudget("b1", USER)).resolves.toBeUndefined();
      expect(budgetRepo.delete).not.toHaveBeenCalled();
    });

    it("writes on an archived budget return RESOURCE_ARCHIVED", async () => {
      const archived = makeBudget({ archivedAt: new Date("2026-08-01") });
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(archived);

      for (const attempt of [
        () => service.updateBudget("b1", { name: "x" }, USER, CTX),
        () => service.setAmountOverride("b1", USER, 10, CTX),
        () => service.clearAmountOverride("b1", USER, CTX),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          code: "RESOURCE_ARCHIVED",
        });
      }
      expect(budgetRepo.update).not.toHaveBeenCalled();
      expect(budgetRepo.setAmountOverride).not.toHaveBeenCalled();
      expect(budgetRepo.clearAmountOverride).not.toHaveBeenCalled();
    });
  });

  // Archiving used to be final. It is not any more, but coming back has to obey
  // the same overlap rule creating one does, or two active budgets would cover
  // the same categories for the same period.
  describe("restoreBudget", () => {
    const archived = () => makeBudget({ archivedAt: new Date() });
    it("un-archives and returns the view", async () => {
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(archived());
      budgetRepo.restore.mockResolvedValue(makeBudget());
      const view = await service.restoreBudget("b1", USER, CTX);
      expect(budgetRepo.restore).toHaveBeenCalledWith("b1", USER);
      expect(view.archivedAt).toBeNull();
    });
    it("refuses when another active budget already covers its categories", async () => {
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(archived());
      budgetRepo.findOverlapping.mockResolvedValue([
        makeBudget({ id: "other" }),
      ]);
      await expect(service.restoreBudget("b1", USER, CTX)).rejects.toThrow(
        "A budget for this category and period type already exists",
      );
      expect(budgetRepo.restore).not.toHaveBeenCalled();
    });
    it("excludes itself from the overlap check", async () => {
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(archived());
      budgetRepo.restore.mockResolvedValue(makeBudget());
      await service.restoreBudget("b1", USER, CTX);
      expect(budgetRepo.findOverlapping).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({
          type: "EXPENSE",
          periodType: "MONTHLY",
          categoryIds: ["c1"],
        }),
        "b1",
      );
    });
    it("hands the overlap rule the CUSTOM window it is bringing back", async () => {
      const window = {
        periodStartDate: new Date("2026-07-01T00:00:00Z"),
        periodEndDate: new Date("2026-08-01T00:00:00Z"),
      };
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(
        makeBudget({ periodType: "CUSTOM", ...window, archivedAt: new Date() }),
      );
      budgetRepo.restore.mockResolvedValue(makeBudget());
      await service.restoreBudget("b1", USER, CTX);
      expect(budgetRepo.findOverlapping).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({ periodType: "CUSTOM", ...window }),
        "b1",
      );
    });
    it("is idempotent: an active budget comes back untouched", async () => {
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(makeBudget());
      const view = await service.restoreBudget("b1", USER, CTX);
      expect(budgetRepo.restore).not.toHaveBeenCalled();
      expect(budgetRepo.findOverlapping).not.toHaveBeenCalled();
      expect(view.id).toBe("b1");
    });
    it("404s for a budget that is not the user's", async () => {
      budgetRepo.getByIdIncludingArchived.mockResolvedValue(null);
      await expect(service.restoreBudget("b1", USER, CTX)).rejects.toThrow(
        "Budget not found",
      );
    });
  });
});
