import { Category } from "../../domain/entities/Category";
import { CategoryFilters, ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { ApiError } from "../../shared/errors";
import { CreateCategoryDTO, UpdateCategoryDTO } from "../dtos/CategoryDTO";

export class CategoryService {
  constructor(
    private repo: ICategoryRepository,
    private transactionRepo: ITransactionRepository,
  ) {}

  async getAllCategories(
    userId: string,
    pagination: PaginationParams,
    filters?: CategoryFilters,
  ): Promise<PaginatedResult<Category>> {
    const result = await this.repo.getAllByUserId(userId, pagination, filters);
    return {
      data: result.data.map((category) => new Category(category)),
      pagination: result.pagination,
    };
  }

  async getCategoryById(id: string, userId: string): Promise<Category> {
    const category = await this.repo.getById(id);
    if (!category) {
      throw new ApiError("NotFound", "Category not found");
    }
    if (category.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }
    return new Category(category);
  }

  async createCategory(dto: CreateCategoryDTO): Promise<Category> {
    const category = new Category(dto);
    return new Category(await this.repo.create(category));
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDTO,
    userId: string,
  ): Promise<Category> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Category id does not match");
    }

    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Category not found");
    }
    if (existing.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }

    return new Category(await this.repo.update(id, dto));
  }

  async deleteCategory(id: string, userId: string): Promise<void> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Category not found");
    }
    if (existing.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }

    const linked = await this.transactionRepo.getAllByUserId(userId, { limit: 1, offset: 0 }, { categoryId: id });
    if (linked.data.length > 0) {
      throw new ApiError("BadRequest", "Cannot delete category with associated transactions");
    }

    return await this.repo.delete(id);
  }
}
