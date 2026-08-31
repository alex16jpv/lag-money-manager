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
  // Unlike getById, also resolves archived categories (callers decide the policy).
  getByIdIncludingArchived(id: string): Promise<Category | null>;
  // Duplicate-tolerant: skips (userId,name) duplicates, inserts the rest.
  createMany(entities: Partial<Category>[]): Promise<Category[]>;
  // Seed keys present for the user, archived included.
  listSeedKeys(userId: string): Promise<string[]>;
  countByUserId(userId: string): Promise<number>;
  restore(id: string, userId: string): Promise<Category | null>;
}
