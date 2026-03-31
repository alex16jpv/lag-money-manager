import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { Category } from "../../entities/Category";
import { IRepository } from "../IRepository";

export interface CategoryFilters {
  ids?: string[];
}

export interface ICategoryRepository extends IRepository<Category> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: CategoryFilters,
  ): Promise<PaginatedResult<Category>>;
}
