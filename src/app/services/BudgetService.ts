import { Budget } from "../../domain/entities/Budget";
import {
  BudgetFilters,
  IBudgetRepository,
} from "../../domain/repositories/budget/IBudgetRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { resolvePeriod } from "../../shared/budgetPeriod";
import { ApiError } from "../../shared/errors";
import { fromCents } from "../../shared/money";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { BudgetView, CreateBudgetDTO, UpdateBudgetDTO } from "../dtos/BudgetDTO";

interface ViewContext {
  reference: Date;
  timezone: string;
}

export class BudgetService {
  constructor(
    private repo: IBudgetRepository,
    private transactionRepo: ITransactionRepository,
    private categoryRepo: ICategoryRepository,
  ) {}

  async getBudgets(
    userId: string,
    pagination: PaginationParams,
    filters: BudgetFilters,
    ctx: ViewContext,
  ): Promise<PaginatedResult<BudgetView>> {
    const result = await this.repo.getAllByUserId(userId, pagination, filters);
    const views = await this.toViews(userId, result.data, ctx);
    // A budget doesn't exist before its lifetime floor: past references skip it.
    const data = views.filter(
      (view, i) =>
        view.periodTo.getTime() > result.data[i].lifetimeFloor().getTime(),
    );
    return { data, pagination: result.pagination };
  }

  async getBudgetById(
    id: string,
    userId: string,
    ctx: ViewContext,
  ): Promise<BudgetView> {
    const budget = await this.getOwned(id, userId);
    const [view] = await this.toViews(userId, [budget], ctx);
    return view;
  }

  async createBudget(dto: CreateBudgetDTO, ctx: ViewContext): Promise<BudgetView> {
    const type = dto.type ?? "EXPENSE";
    this.assertValidPeriod(dto);
    await this.assertCategoriesUsable(dto.userId, dto.categoryIds, type);
    await this.assertNoOverlap(dto.userId, type, dto.periodType, dto.categoryIds);
    const created = await this.repo.create(new Budget(dto));
    const [view] = await this.toViews(dto.userId, [created], ctx);
    return view;
  }

  async updateBudget(
    id: string,
    dto: UpdateBudgetDTO,
    userId: string,
    ctx: ViewContext,
  ): Promise<BudgetView> {
    const existing = await this.getOwned(id, userId);
    const patch: Partial<Budget> = { ...dto };
    if (dto.periodType && dto.periodType !== existing.periodType) {
      // Override keys are period-type-specific: stale ones would never match.
      patch.amountOverrides = {};
      if (dto.periodType !== "CUSTOM") {
        patch.periodStartDate = null;
        patch.periodEndDate = null;
      }
    }
    const merged = new Budget({ ...existing, ...patch });
    this.assertValidPeriod(merged);
    if (dto.categoryIds !== undefined || dto.type !== undefined) {
      await this.assertCategoriesUsable(
        userId,
        merged.categoryIds,
        merged.type,
        existing.categoryIds,
      );
    }
    await this.assertNoOverlap(
      userId,
      merged.type,
      merged.periodType,
      merged.categoryIds,
      id,
    );
    const updated = await this.repo.update(id, patch);
    const [view] = await this.toViews(userId, [updated], ctx);
    return view;
  }

  async deleteBudget(id: string, userId: string): Promise<void> {
    await this.getOwned(id, userId);
    await this.repo.delete(id);
  }

  async clearAmountOverride(
    id: string,
    userId: string,
    ctx: ViewContext,
  ): Promise<BudgetView> {
    const budget = await this.getOwned(id, userId);
    const { key } = resolvePeriod(this.periodDef(budget), ctx.reference, ctx.timezone);
    const updated = await this.repo.clearAmountOverride(id, userId, key);
    if (!updated) {
      throw new ApiError("NotFound", "Budget not found");
    }
    const [view] = await this.toViews(userId, [updated], ctx);
    return view;
  }

  async setAmountOverride(
    id: string,
    userId: string,
    amount: number,
    ctx: ViewContext,
  ): Promise<BudgetView> {
    const budget = await this.getOwned(id, userId);
    const { key } = resolvePeriod(this.periodDef(budget), ctx.reference, ctx.timezone);
    const updated = await this.repo.setAmountOverride(id, userId, key, amount);
    if (!updated) {
      throw new ApiError("NotFound", "Budget not found");
    }
    const [view] = await this.toViews(userId, [updated], ctx);
    return view;
  }

  private async getOwned(id: string, userId: string): Promise<Budget> {
    const budget = await this.repo.getById(id);
    if (!budget) {
      throw new ApiError("NotFound", "Budget not found");
    }
    if (budget.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }
    return budget;
  }

  private periodDef(budget: Budget) {
    return {
      type: budget.periodType,
      startDate: budget.periodStartDate ?? undefined,
      endDate: budget.periodEndDate ?? undefined,
    };
  }

  private assertValidPeriod(budget: {
    periodType: string;
    periodStartDate?: Date | null;
    periodEndDate?: Date | null;
  }): void {
    if (budget.periodType === "CUSTOM") {
      if (!budget.periodStartDate || !budget.periodEndDate) {
        throw new ApiError(
          "BadRequest",
          "Custom period requires startDate and endDate",
        );
      }
      if (budget.periodStartDate >= budget.periodEndDate) {
        throw new ApiError("BadRequest", "startDate must be before endDate");
      }
    } else if (budget.periodStartDate || budget.periodEndDate) {
      throw new ApiError(
        "BadRequest",
        "periodStartDate/periodEndDate are only allowed for CUSTOM budgets",
      );
    }
  }

  // Same policy as transactions (R2-05): 404 for missing/foreign, archived
  // rejected unless the budget already carried it.
  private async assertCategoriesUsable(
    userId: string,
    categoryIds: string[],
    budgetType: string,
    previous: string[] = [],
  ): Promise<void> {
    const prev = new Set(previous);
    for (const categoryId of categoryIds) {
      const category =
        await this.categoryRepo.getByIdIncludingArchived(categoryId);
      if (!category || category.userId !== userId) {
        throw new ApiError("NotFound", "Category not found");
      }
      if (category.archivedAt && !prev.has(categoryId)) {
        throw new ApiError("BadRequest", "Category is archived", "CATEGORY_ARCHIVED");
      }
      if (category.type && category.type !== budgetType) {
        throw new ApiError(
          "BadRequest",
          `Category type ${category.type} does not match budget type ${budgetType}`,
          "CATEGORY_TYPE_MISMATCH",
        );
      }
    }
  }

  private async assertNoOverlap(
    userId: string,
    type: string,
    periodType: string,
    categoryIds: string[],
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.repo.findOverlapping(
      userId,
      type as never,
      periodType as never,
      categoryIds,
      excludeId,
    );
    if (overlapping.length > 0) {
      throw new ApiError(
        "BadRequest",
        "A budget for this category and period type already exists",
        "BUDGET_PERIOD_OVERLAP",
      );
    }
  }

  // Resolves each budget's current-period window and spend. Budgets sharing a
  // window are summed with a single aggregation.
  private async toViews(
    userId: string,
    budgets: Budget[],
    ctx: ViewContext,
  ): Promise<BudgetView[]> {
    const resolved = budgets.map((b) => ({
      budget: b,
      period: resolvePeriod(this.periodDef(b), ctx.reference, ctx.timezone),
    }));

    const windows = new Map<
      string,
      {
        from: Date;
        to: Date;
        type: "EXPENSE" | "INCOME";
        categoryIds: Set<string>;
        hasGlobal: boolean;
      }
    >();
    for (const { budget, period } of resolved) {
      const wk = `${period.from.getTime()}_${period.to.getTime()}_${budget.type}`;
      const w = windows.get(wk) ?? {
        from: period.from,
        to: period.to,
        type: budget.type,
        categoryIds: new Set<string>(),
        hasGlobal: false,
      };
      if (budget.categoryIds.length === 0) {
        // Global budget: spend is the window's TOTAL expense (uncategorized
        // and quick-adds included), not a per-category sum.
        w.hasGlobal = true;
      } else {
        budget.categoryIds.forEach((c) => w.categoryIds.add(c));
      }
      windows.set(wk, w);
    }

    const allCategoryIds = [
      ...new Set(budgets.flatMap((b) => b.categoryIds)),
    ];
    const archivedIds = new Set(
      await this.categoryRepo.listArchivedIds(userId, allCategoryIds),
    );

    const sums = new Map<string, Record<string, number>>();
    const totals = new Map<string, number>();
    await Promise.all(
      Array.from(windows.entries()).map(async ([wk, w]) => {
        if (w.categoryIds.size > 0) {
          const map = await this.transactionRepo.sumAmountsByCategory(
            userId,
            w.from,
            w.to,
            Array.from(w.categoryIds),
            w.type,
          );
          sums.set(wk, map);
        }
        if (w.hasGlobal) {
          totals.set(
            wk,
            await this.transactionRepo.sumAmounts(userId, w.from, w.to, w.type),
          );
        }
      }),
    );

    return resolved.map(({ budget, period }) => {
      const wk = `${period.from.getTime()}_${period.to.getTime()}_${budget.type}`;
      const map = sums.get(wk) ?? {};
      const spentCents =
        budget.categoryIds.length === 0
          ? (totals.get(wk) ?? 0)
          : budget.categoryIds.reduce((acc, c) => acc + (map[c] ?? 0), 0);
      const amount = budget.amountForPeriod(period.key);
      return {
        id: budget.id,
        name: budget.name,
        color: budget.color,
        categoryIds: budget.categoryIds,
        archivedCategoryIds: budget.categoryIds.filter((c) =>
          archivedIds.has(c),
        ),
        type: budget.type,
        periodType: budget.periodType,
        periodKey: period.key,
        periodFrom: period.from,
        periodTo: period.to,
        baseAmount: budget.amount,
        amount,
        spent: fromCents(spentCents),
        hasOverride: budget.amountOverrides[period.key] !== undefined,
        effectiveFrom: budget.lifetimeFloor(),
        note: budget.note,
        archivedAt: budget.archivedAt,
      };
    });
  }
}
