import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { Category } from "../../entities/Category";
import { IRepository } from "../IRepository";

export interface CategoryFilters {
  ids?: string[];
  type?: string;
  includeArchived?: boolean;
}

export interface ICategoryRepository extends IRepository<Category> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: CategoryFilters,
  ): Promise<PaginatedResult<Category>>;
  // Owner-scoped read for client-minted id replay; resolves archived/deleted too.
  getOwnById(id: string, userId: string): Promise<Category | null>;
  // Unlike getById, also resolves archived categories (callers decide the policy).
  getByIdIncludingArchived(id: string): Promise<Category | null>;
  // Duplicate-tolerant: skips (userId,name) duplicates, inserts the rest.
  createMany(entities: Partial<Category>[]): Promise<Category[]>;
  // Seed keys present for the user, archived included.
  listSeedKeys(userId: string): Promise<string[]>;
  // Which of the given ids are the user's ARCHIVED categories (one query).
  listArchivedIds(userId: string, ids: string[]): Promise<string[]>;
  countByUserId(userId: string): Promise<number>;
  // `name` renames as part of the same write, so the unique index sees the
  // final state and no one can take the name in between.
  restore(id: string, userId: string, name?: string): Promise<Category | null>;
}
