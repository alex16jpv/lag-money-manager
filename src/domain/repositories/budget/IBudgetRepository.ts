import { BudgetPeriodType, BudgetType } from "../../../shared/constants";
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { Budget } from "../../entities/Budget";
import { IRepository } from "../IRepository";

export interface BudgetFilters {
  includeArchived?: boolean;
  // View-level: expiry depends on the reference date, the repo ignores it.
  includeExpired?: boolean;
}

// What a create, update or restore would leave active, as the overlap rule
// judges it.
export interface OverlapCandidate {
  type: BudgetType;
  periodType: BudgetPeriodType;
  categoryIds: string[];
  periodStartDate?: Date | null;
  periodEndDate?: Date | null;
}

export interface IBudgetRepository extends IRepository<Budget> {
  // Owner-scoped read for client-minted id replay; resolves archived/deleted too.
  getOwnById(id: string, userId: string): Promise<Budget | null>;

  // Unlike getById, also resolves archived budgets (uniform semantics:
  // archived resources stay readable; writes reject with RESOURCE_ARCHIVED).
  getByIdIncludingArchived(id: string): Promise<Budget | null>;

  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: BudgetFilters,
  ): Promise<PaginatedResult<Budget>>;

  // Active budgets the candidate would overlap: same type and period type,
  // sharing a category (or both global); CUSTOM ones only when their date
  // windows intersect. `excludeId` skips the budget being updated or restored.
  findOverlapping(
    userId: string,
    candidate: OverlapCandidate,
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
