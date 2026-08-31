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
  createMany(entities: Partial<Category>[]): Promise<Category[]>;
  restore(id: string, userId: string): Promise<Category | null>;
}
