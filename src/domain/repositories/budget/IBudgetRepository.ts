import { BudgetPeriodType, BudgetType } from "../../../shared/constants";
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { ChangeCursor } from "../../../shared/syncCursor";
import { Budget } from "../../entities/Budget";
import { IRepository } from "../IRepository";

export interface BudgetFilters {
  includeArchived?: boolean;
  // View-level: expiry depends on the reference date, the repo ignores it.
  includeExpired?: boolean;
}

// What a create, update or restore would leave active, as the overlap rule judges it.
export interface OverlapCandidate {
  type: BudgetType;
  periodType: BudgetPeriodType;
  categoryIds: string[];
  periodStartDate?: Date | null;
  periodEndDate?: Date | null;
}

export interface IBudgetRepository extends IRepository<Budget> {
  // `expectedUpdatedAt` goes in the write's own filter: a guard checked before would race.
  update(
    id: string,
    entity: Partial<Budget>,
    session?: unknown,
    expectedUpdatedAt?: Date,
  ): Promise<Budget>;
  // Archives and answers the archived row.
  delete(
    id: string,
    session?: unknown,
    expectedUpdatedAt?: Date,
  ): Promise<Budget>;

  // Owner-scoped read for client-minted id replay; resolves archived/deleted too.
  getOwnById(id: string, userId: string): Promise<Budget | null>;

  // Change feed after `cursor` in (updatedAt, _id) order, archived and deleted rows included.
  changesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<Budget[]>;

  // Unlike getById, resolves archived budgets too: writes are what reject with RESOURCE_ARCHIVED.
  getByIdIncludingArchived(id: string): Promise<Budget | null>;

  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: BudgetFilters,
  ): Promise<PaginatedResult<Budget>>;

  // CUSTOM ones collide only when their windows intersect; `excludeId` skips the row being written.
  findOverlapping(
    userId: string,
    candidate: OverlapCandidate,
    excludeId?: string,
  ): Promise<Budget[]>;

  // Clearing archivedAt in one write lets the partial index catch a concurrent restore.
  restore(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Budget | null>;

  clearAmountOverride(
    id: string,
    userId: string,
    periodKey: string,
    expectedUpdatedAt?: Date,
  ): Promise<Budget | null>;

  setAmountOverride(
    id: string,
    userId: string,
    periodKey: string,
    amount: number,
    expectedUpdatedAt?: Date,
  ): Promise<Budget | null>;
}
