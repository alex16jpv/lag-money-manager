import { BudgetPeriodType, BudgetType } from "../../../shared/constants";
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { Budget } from "../../entities/Budget";
import { IRepository } from "../IRepository";

export interface BudgetFilters {
  includeArchived?: boolean;
  // View-level: expiry depends on the reference date, the repo ignores it.
  includeExpired?: boolean;
}

export interface IBudgetRepository extends IRepository<Budget> {
  // Unlike getById, also resolves archived budgets (uniform semantics:
  // archived resources stay readable; writes reject with RESOURCE_ARCHIVED).
  getByIdIncludingArchived(id: string): Promise<Budget | null>;

  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: BudgetFilters,
  ): Promise<PaginatedResult<Budget>>;

  // Active budgets of the same period type that share any of the given
  // categories (used to reject duplicates). `excludeId` skips a budget being updated.
  findOverlapping(
    userId: string,
    type: BudgetType,
    periodType: BudgetPeriodType,
    categoryIds: string[],
    excludeId?: string,
  ): Promise<Budget[]>;

  // Un-archives the user's own archived budget; null if there was none to
  // restore. Clearing archivedAt in a single write lets the partial unique
  // index judge the resulting state and catch a concurrent restore.
  restore(id: string, userId: string): Promise<Budget | null>;

  clearAmountOverride(
    id: string,
    userId: string,
    periodKey: string,
  ): Promise<Budget | null>;

  setAmountOverride(
    id: string,
    userId: string,
    periodKey: string,
    amount: number,
  ): Promise<Budget | null>;
}
