import { Category } from "../../domain/entities/Category";
import {
  CategoryFilters,
  ICategoryRepository,
} from "../../domain/repositories/category/ICategoryRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh, guardedWrite } from "../../shared/concurrency";
import { DEFAULT_CATEGORIES } from "../../shared/defaultCategories";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { CreateCategoryDTO, UpdateCategoryDTO } from "../dtos/CategoryDTO";

// Soft cap: protects the shared Atlas M0 tier from runaway creation.
const MAX_CATEGORIES_PER_USER = 200;

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

  // Reads resolve archived categories too; only the listing hides them by default.
  async getCategoryById(id: string, userId: string): Promise<Category> {
    const category = await this.repo.getByIdIncludingArchived(id);
    if (!category || category.userId !== userId) {
      throw new ApiError("NotFound", "Category not found");
    }
    return new Category(category);
  }

  // Matched case-insensitively like the unique index: what a DUPLICATE on a create is about (§5.1).
  async findActiveByName(
    userId: string,
    name: string,
  ): Promise<Category | null> {
    const category = await this.repo.findActiveByName(userId, name);
    return category && new Category(category);
  }

  async createCategory(
    dto: CreateCategoryDTO,
    outcome?: CreateOutcome,
  ): Promise<Category> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.repo.getOwnById(id, dto.userId),
      replay: async (c) => new Category(c),
      create: () => this.insertCategory(dto),
    });
  }

  private async insertCategory(dto: CreateCategoryDTO): Promise<Category> {
    if (
      (await this.repo.countByUserId(dto.userId)) >= MAX_CATEGORIES_PER_USER
    ) {
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
    expectedUpdatedAt?: Date,
  ): Promise<Category> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Category id does not match");
    }

    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "Category not found");
    }
    // Before the archived check: an old-version caller needs to re-read, not a reason it cannot know.
    assertFresh(existing, expectedUpdatedAt, (c) => new Category(c));
    if (existing.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Category is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }

    // A category's type is part of its history: changing it would silently reclassify stats.
    const typeChanged =
      dto.type !== undefined && (dto.type ?? null) !== (existing.type ?? null);
    if (typeChanged) {
      const linked = await this.transactionRepo.countByCategory(userId, id);
      if (linked > 0) {
        throw new ApiError(
          "BadRequest",
          "Cannot change the type of a category with transactions; create a new category instead",
          "CATEGORY_TYPE_LOCKED",
        );
      }
    }

    return guardedWrite(
      expectedUpdatedAt,
      async () =>
        new Category(
          await this.repo.update(id, dto, undefined, expectedUpdatedAt),
        ),
      () => this.repo.getOwnById(id, userId),
      (c) => new Category(c),
    );
  }

  // F-22: idempotent, and it answers the archived row so a queued restore can guard on its updatedAt.
  async deleteCategory(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Category> {
    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "Category not found");
    }
    assertFresh(existing, expectedUpdatedAt, (c) => new Category(c));
    if (existing.archivedAt) {
      return new Category(existing);
    }
    try {
      return new Category(
        await this.repo.delete(id, undefined, expectedUpdatedAt),
      );
    } catch (err) {
      // Lost the race to a concurrent archive: still a success.
      const current = await this.repo.getByIdIncludingArchived(id);
      if (current?.userId === userId) {
        assertFresh(current, expectedUpdatedAt, (c) => new Category(c));
        if (current.archivedAt) {
          return new Category(current);
        }
      }
      throw err;
    }
  }

  // Idempotent: restoring an already-active category returns it unchanged.
  async restoreCategory(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<Category> {
    const restored = await this.repo.restore(
      id,
      userId,
      name,
      expectedUpdatedAt,
    );
    if (restored) {
      return new Category(restored);
    }
    const current = await this.repo.getByIdIncludingArchived(id);
    if (!current || current.userId !== userId) {
      throw new ApiError("NotFound", "Category not found");
    }
    assertFresh(current, expectedUpdatedAt, (c) => new Category(c));
    return new Category(current);
  }

  async seedDefaultCategories(userId: string): Promise<Category[]> {
    const categories = DEFAULT_CATEGORIES.map(
      (cat) => new Category({ ...cat, userId }),
    );
    const created = await this.repo.createMany(categories);
    return created.map((c) => new Category(c));
  }

  // Idempotent by seedKey: archived seeds count as present and renamed ones keep theirs.
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
