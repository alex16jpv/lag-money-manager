import { Category } from "../../domain/entities/Category";
import { CategoryFilters, ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { DEFAULT_CATEGORIES } from "../../shared/defaultCategories";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { CreateCategoryDTO, UpdateCategoryDTO } from "../dtos/CategoryDTO";

export class CategoryService {
  constructor(private repo: ICategoryRepository) {}

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

  // Archive (soft delete). Allowed even with linked transactions: the category
  // document is kept, so existing transactions keep resolving it; it is only
  // hidden from active listings and its name is freed for reuse.
  async deleteCategory(id: string, userId: string): Promise<void> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Category not found");
    }
    if (existing.userId !== userId) {
      throw new ApiError("Forbidden", "Access denied");
    }

    return await this.repo.delete(id);
  }

  async restoreCategory(id: string, userId: string): Promise<Category> {
    const restored = await this.repo.restore(id, userId);
    if (!restored) {
      throw new ApiError("NotFound", "Archived category not found");
    }
    return new Category(restored);
  }

  async seedDefaultCategories(userId: string): Promise<Category[]> {
    const categories = DEFAULT_CATEGORIES.map(
      (cat) => new Category({ ...cat, userId }),
    );
    const created = await this.repo.createMany(categories);
    return created.map((c) => new Category(c));
  }
}
