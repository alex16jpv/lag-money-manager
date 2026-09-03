import { v7 as uuidv7 } from "uuid";

import { Category } from "../../../domain/entities/Category";
import {
  CategoryFilters,
  ICategoryRepository,
} from "../../../domain/repositories/category/ICategoryRepository";
import { ApiError } from "../../../shared/errors";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { CategoryModel, ICategoryDocument } from "../../models/CategoryModel";

export class CategoryRepository implements ICategoryRepository {
  private toEntity(doc: ICategoryDocument): Category {
    return new Category({
      id: doc._id,
      name: doc.name,
      icon: doc.icon,
      color: doc.color,
      type: doc.type,
      userId: doc.userId,
      seedKey: doc.seedKey,
      archivedAt: doc.archivedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Category>> {
    const { limit, offset, cursor } = pagination;
    const filter = { ...baseFilter };
    if (cursor) {
      // Merge with an ids ($in) filter instead of clobbering it.
      filter._id =
        filter._id && typeof filter._id === "object"
          ? { ...(filter._id as Record<string, unknown>), $gt: cursor }
          : { $gt: cursor };
    }

    const [docs, total] = await Promise.all([
      CategoryModel.find(filter)
        .sort({ _id: 1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      CategoryModel.countDocuments(baseFilter),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async getById(id: string): Promise<Category | null> {
    const doc = await CategoryModel.findOne({
      _id: id,
      archivedAt: null,
    }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getByIdIncludingArchived(id: string): Promise<Category | null> {
    const doc = await CategoryModel.findOne({ _id: id }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Category>> {
    return this.paginatedFind({ archivedAt: null }, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: CategoryFilters,
  ): Promise<PaginatedResult<Category>> {
    const filter: Record<string, unknown> = { userId };
    if (!filters?.includeArchived) {
      filter.archivedAt = null;
    }
    if (filters?.ids?.length) {
      filter._id = { $in: filters.ids };
    }
    if (filters?.type) {
      filter.type = filters.type;
    }
    return this.paginatedFind(filter, pagination);
  }

  async create(category: Partial<Category>): Promise<Category> {
    const id = category.id ?? uuidv7();
    const doc = await CategoryModel.create({ _id: id, ...category });
    return this.toEntity(doc);
  }

  async createMany(categories: Partial<Category>[]): Promise<Category[]> {
    const payload = categories.map((c) => ({ _id: c.id ?? uuidv7(), ...c }));
    try {
      const docs = await CategoryModel.insertMany(payload, { ordered: false });
      return docs.map((doc) =>
        this.toEntity(doc as unknown as ICategoryDocument),
      );
    } catch (err) {
      // Duplicates (unique userId+name) are skipped and the rest inserted:
      // this makes the register seed and restore-defaults retry-safe.
      const bulk = err as {
        insertedDocs?: unknown[];
        writeErrors?: { code?: number; err?: { code?: number } }[];
      };
      const onlyDuplicates =
        bulk.writeErrors?.length &&
        bulk.writeErrors.every((w) => (w.code ?? w.err?.code) === 11000);
      if (bulk.insertedDocs && onlyDuplicates) {
        return bulk.insertedDocs.map((d) =>
          this.toEntity(d as ICategoryDocument),
        );
      }
      throw err;
    }
  }

  async countByUserId(userId: string): Promise<number> {
    return CategoryModel.countDocuments({ userId, archivedAt: null });
  }

  async listArchivedIds(userId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const docs = await CategoryModel.find({
      userId,
      _id: { $in: ids },
      archivedAt: { $ne: null },
    })
      .select("_id")
      .lean();
    return docs.map((d) => d._id);
  }

  async listSeedKeys(userId: string): Promise<string[]> {
    // Includes archived: an archived seed category counts as existing
    // (the user chose to remove it; restore-defaults must not resurrect it).
    const keys = await CategoryModel.distinct("seedKey", {
      userId,
      seedKey: { $ne: null },
    });
    return keys as string[];
  }

  async update(id: string, category: Partial<Category>): Promise<Category> {
    const doc = await CategoryModel.findOneAndUpdate(
      { _id: id, archivedAt: null },
      category,
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Category not found");
    }
    return this.toEntity(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await CategoryModel.findOneAndUpdate(
      { _id: id, archivedAt: null },
      { archivedAt: new Date() },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Category not found");
    }
  }

  async restore(
    id: string,
    userId: string,
    name?: string,
  ): Promise<Category | null> {
    const doc = await CategoryModel.findOneAndUpdate(
      { _id: id, userId, archivedAt: { $ne: null } },
      { archivedAt: null, ...(name ? { name } : {}) },
      { new: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }
}
