import { BudgetPeriodType } from "../../../shared/constants";
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { Budget } from "../../entities/Budget";
import { IRepository } from "../IRepository";

export interface BudgetFilters {
  includeArchived?: boolean;
}

export interface IBudgetRepository extends IRepository<Budget> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: BudgetFilters,
  ): Promise<PaginatedResult<Budget>>;

  restore(id: string, userId: string): Promise<Budget | null>;

  // Active budgets of the same period type that share any of the given
  // categories (used to reject duplicates). `excludeId` skips a budget being updated.
  findOverlapping(
    userId: string,
    periodType: BudgetPeriodType,
    categoryIds: string[],
    excludeId?: string,
  ): Promise<Budget[]>;

  setAmountOverride(
    id: string,
    userId: string,
    periodKey: string,
    amount: number,
  ): Promise<Budget | null>;
}
