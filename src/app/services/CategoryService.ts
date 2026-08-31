import { Category } from "../../domain/entities/Category";
import { CategoryFilters, ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { DEFAULT_CATEGORIES } from "../../shared/defaultCategories";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { CreateCategoryDTO, UpdateCategoryDTO } from "../dtos/CategoryDTO";

// Soft cap: protects the shared Atlas M0 tier from runaway creation.
const MAX_CATEGORIES_PER_USER = 200;

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
      throw new ApiError("NotFound", "Category not found");
    }
    return new Category(category);
  }

  async createCategory(dto: CreateCategoryDTO): Promise<Category> {
    if ((await this.repo.countByUserId(dto.userId)) >= MAX_CATEGORIES_PER_USER) {
      throw new ApiError(
        "BadRequest",
        `Category limit reached (${MAX_CATEGORIES_PER_USER})`,
        "CATEGORY_LIMIT_REACHED",
      );
    }
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
      throw new ApiError("NotFound", "Category not found");
    }

    return new Category(await this.repo.update(id, dto));
  }

  // Archive (soft delete); allowed even with linked transactions.
  async deleteCategory(id: string, userId: string): Promise<void> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new ApiError("NotFound", "Category not found");
    }
    if (existing.userId !== userId) {
      throw new ApiError("NotFound", "Category not found");
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

  // Idempotent by seedKey: creates only the missing defaults. Archived seed
  // categories count as present (the user removed them on purpose) and
  // renamed ones keep their seedKey, so neither gets duplicated.
  async restoreDefaults(userId: string): Promise<Category[]> {
    const existing = new Set(await this.repo.listSeedKeys(userId));
    const missing = DEFAULT_CATEGORIES.filter((c) => !existing.has(c.seedKey));
    if (missing.length === 0) {
      return [];
    }
    const created = await this.repo.createMany(
      missing.map((cat) => new Category({ ...cat, userId })),
    );
    return created.map((c) => new Category(c));
  }
}
