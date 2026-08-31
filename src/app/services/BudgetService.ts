import { Budget } from "../../domain/entities/Budget";
import {
  BudgetFilters,
  IBudgetRepository,
} from "../../domain/repositories/budget/IBudgetRepository";
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
  ) {}

  async getBudgets(
    userId: string,
    pagination: PaginationParams,
    filters: BudgetFilters,
    ctx: ViewContext,
  ): Promise<PaginatedResult<BudgetView>> {
    const result = await this.repo.getAllByUserId(userId, pagination, filters);
    const views = await this.toViews(userId, result.data, ctx);
    return { data: views, pagination: result.pagination };
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
    this.assertValidPeriod(dto);
    await this.assertNoOverlap(dto.userId, dto.periodType, dto.categoryIds);
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
    const merged = new Budget({ ...existing, ...dto });
    this.assertValidPeriod(merged);
    await this.assertNoOverlap(
      userId,
      merged.periodType,
      merged.categoryIds,
      id,
    );
    const updated = await this.repo.update(id, dto);
    const [view] = await this.toViews(userId, [updated], ctx);
    return view;
  }

  async deleteBudget(id: string, userId: string): Promise<void> {
    await this.getOwned(id, userId);
    await this.repo.delete(id);
  }

  async restoreBudget(
    id: string,
    userId: string,
    ctx: ViewContext,
  ): Promise<BudgetView> {
    const restored = await this.repo.restore(id, userId);
    if (!restored) {
      throw new ApiError("NotFound", "Archived budget not found");
    }
    const [view] = await this.toViews(userId, [restored], ctx);
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
    }
  }

  private async assertNoOverlap(
    userId: string,
    periodType: string,
    categoryIds: string[],
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.repo.findOverlapping(
      userId,
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
      { from: Date; to: Date; categoryIds: Set<string> }
    >();
    for (const { budget, period } of resolved) {
      const wk = `${period.from.getTime()}_${period.to.getTime()}`;
      const w = windows.get(wk) ?? {
        from: period.from,
        to: period.to,
        categoryIds: new Set<string>(),
      };
      budget.categoryIds.forEach((c) => w.categoryIds.add(c));
      windows.set(wk, w);
    }

    const sums = new Map<string, Record<string, number>>();
    await Promise.all(
      Array.from(windows.entries()).map(async ([wk, w]) => {
        const map = await this.transactionRepo.sumExpensesByCategory(
          userId,
          w.from,
          w.to,
          Array.from(w.categoryIds),
        );
        sums.set(wk, map);
      }),
    );

    return resolved.map(({ budget, period }) => {
      const wk = `${period.from.getTime()}_${period.to.getTime()}`;
      const map = sums.get(wk) ?? {};
      const spentCents = budget.categoryIds.reduce(
        (acc, c) => acc + (map[c] ?? 0),
        0,
      );
      const amount = budget.amountForPeriod(period.key);
      return {
        id: budget.id,
        name: budget.name,
        color: budget.color,
        categoryIds: budget.categoryIds,
        periodType: budget.periodType,
        periodKey: period.key,
        periodFrom: period.from,
        periodTo: period.to,
        baseAmount: budget.amount,
        amount,
        spent: fromCents(spentCents),
        note: budget.note,
        archivedAt: budget.archivedAt,
      };
    });
  }
}
