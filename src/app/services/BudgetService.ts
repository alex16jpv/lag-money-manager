import { Budget } from "../../domain/entities/Budget";
import {
  BudgetFilters,
  IBudgetRepository,
  OverlapCandidate,
} from "../../domain/repositories/budget/IBudgetRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { assertAmountPrecision } from "../../shared/money";
import { resolvePeriod } from "../../shared/budgetPeriod";
import { ApiError } from "../../shared/errors";
import { fromCents } from "../../shared/money";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import {
  BudgetView,
  CreateBudgetDTO,
  UpdateBudgetDTO,
} from "../dtos/BudgetDTO";

interface ViewContext {
  reference: Date;
  timezone: string;
}

export class BudgetService {
  constructor(
    private repo: IBudgetRepository,
    private transactionRepo: ITransactionRepository,
    private categoryRepo: ICategoryRepository,
    private userRepo: IUserRepository,
  ) {}

  async getBudgets(
    userId: string,
    pagination: PaginationParams,
    filters: BudgetFilters,
    ctx: ViewContext,
  ): Promise<PaginatedResult<BudgetView>> {
    const result = await this.repo.getAllByUserId(userId, pagination, filters);
    const views = await this.toViews(userId, result.data, ctx);
    // A budget doesn't exist before its lifetime floor, and an expired CUSTOM
    // one-shot leaves the default listing (recurring types roll forward).
    const data = views.filter((view, i) => {
      if (view.periodTo.getTime() <= result.data[i].lifetimeFloor().getTime()) {
        return false;
      }
      return filters.includeExpired || !view.expired;
    });
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

  async createBudget(
    dto: CreateBudgetDTO,
    ctx: ViewContext,
  ): Promise<BudgetView> {
    const type = dto.type ?? "EXPENSE";
    this.assertValidPeriod(dto);
    await this.assertCategoriesUsable(dto.userId, dto.categoryIds, type);
    await this.assertNoOverlap(dto.userId, { ...dto, type });
    // Mono-currency mode: stamped from the owner at creation.
    const owner = await this.userRepo.getById(dto.userId);
    const currency = owner?.currency ?? DEFAULT_CURRENCY;
    assertAmountPrecision(dto.amount, currency, "amount");
    const created = await this.repo.create(new Budget({ ...dto, currency }));
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
    this.assertWritable(existing);
    const patch: Partial<Budget> = { ...dto };
    if (dto.periodType && dto.periodType !== existing.periodType) {
      // Override keys are period-type-specific: stale ones would never match.
      patch.amountOverrides = {};
      if (dto.periodType !== "CUSTOM") {
        patch.periodStartDate = null;
        patch.periodEndDate = null;
      }
    } else if (
      existing.periodType === "CUSTOM" &&
      ((dto.periodStartDate !== undefined &&
        dto.periodStartDate?.getTime() !==
          existing.periodStartDate?.getTime()) ||
        (dto.periodEndDate !== undefined &&
          dto.periodEndDate?.getTime() !== existing.periodEndDate?.getTime()))
    ) {
      // CUSTOM override keys encode the window dates: moving the window
      // orphans them.
      patch.amountOverrides = {};
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
    await this.assertNoOverlap(userId, merged, id);
    const updated = await this.repo.update(id, patch);
    const [view] = await this.toViews(userId, [updated], ctx);
    return view;
  }

  // Idempotent: archiving an already-archived budget is a no-op success.
  async deleteBudget(id: string, userId: string): Promise<void> {
    const existing = await this.getOwned(id, userId);
    if (existing.archivedAt) {
      return;
    }
    try {
      await this.repo.delete(id);
    } catch (err) {
      // Lost the race to a concurrent archive: still a success.
      const current = await this.repo.getByIdIncludingArchived(id);
      if (current?.userId === userId && current.archivedAt) {
        return;
      }
      throw err;
    }
  }

  /**
   * Un-archives a budget. Owner's decision: no body — the overlap rule decides
   * whether it can come back as it is, and changing its categories or period
   * would make it a different budget, so the user creates a new one instead.
   *
   * Nothing about it is rewritten: overrides, effectiveFrom, note, colour and
   * categoryIds return untouched, archived categories included. A finished
   * CUSTOM one comes back `expired`.
   */
  async restoreBudget(
    id: string,
    userId: string,
    ctx: ViewContext,
  ): Promise<BudgetView> {
    const existing = await this.getOwned(id, userId);
    // Idempotent, like accounts and categories: an active budget comes back
    // unchanged rather than erroring.
    if (existing.archivedAt) {
      await this.assertNoOverlap(userId, existing, existing.id);
      const restored = await this.repo.restore(id, userId);
      if (restored) {
        const [view] = await this.toViews(userId, [restored], ctx);
        return view;
      }
      // Lost the race to a concurrent restore: whatever is stored now is the
      // answer, and it is no longer archived.
      const current = await this.getOwned(id, userId);
      const [view] = await this.toViews(userId, [current], ctx);
      return view;
    }
    const [view] = await this.toViews(userId, [existing], ctx);
    return view;
  }

  async clearAmountOverride(
    id: string,
    userId: string,
    ctx: ViewContext,
  ): Promise<BudgetView> {
    const budget = await this.getOwned(id, userId);
    this.assertWritable(budget);
    const { key } = resolvePeriod(
      this.periodDef(budget),
      ctx.reference,
      ctx.timezone,
    );
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
    this.assertWritable(budget);
    assertAmountPrecision(
      amount,
      budget.currency ?? DEFAULT_CURRENCY,
      "amount",
    );
    const { key } = resolvePeriod(
      this.periodDef(budget),
      ctx.reference,
      ctx.timezone,
    );
    const updated = await this.repo.setAmountOverride(id, userId, key, amount);
    if (!updated) {
      throw new ApiError("NotFound", "Budget not found");
    }
    const [view] = await this.toViews(userId, [updated], ctx);
    return view;
  }

  // Uniform semantics: archived budgets stay readable; callers that write
  // must go through assertWritable.
  private async getOwned(id: string, userId: string): Promise<Budget> {
    const budget = await this.repo.getByIdIncludingArchived(id);
    if (!budget || budget.userId !== userId) {
      throw new ApiError("NotFound", "Budget not found");
    }
    return budget;
  }

  private assertWritable(budget: Budget): void {
    if (budget.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Budget is archived",
        "RESOURCE_ARCHIVED",
      );
    }
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
        throw new ApiError(
          "BadRequest",
          "Category is archived",
          "CATEGORY_ARCHIVED",
        );
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
    candidate: OverlapCandidate,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.repo.findOverlapping(
      userId,
      candidate,
      excludeId,
    );
    if (overlapping.length > 0) {
      throw new ApiError(
        "BadRequest",
        candidate.periodType === "CUSTOM"
          ? "A budget for this category already covers part of these dates"
          : "A budget for this category and period type already exists",
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

    const allCategoryIds = [...new Set(budgets.flatMap((b) => b.categoryIds))];
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
        currency: budget.currency ?? DEFAULT_CURRENCY,
        periodType: budget.periodType,
        periodKey: period.key,
        periodFrom: period.from,
        periodTo: period.to,
        baseAmount: budget.amount,
        amount,
        spent: fromCents(spentCents),
        hasOverride: budget.amountOverrides[period.key] !== undefined,
        expired:
          budget.periodType === "CUSTOM" &&
          budget.periodEndDate !== null &&
          ctx.reference.getTime() >= budget.periodEndDate.getTime(),
        effectiveFrom: budget.lifetimeFloor(),
        note: budget.note,
        archivedAt: budget.archivedAt,
        createdAt: budget.createdAt,
        updatedAt: budget.updatedAt,
      };
    });
  }
}
