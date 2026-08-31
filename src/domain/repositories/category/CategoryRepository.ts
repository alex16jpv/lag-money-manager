import { v7 as uuidv7 } from "uuid";

import { ApiError } from "../../../shared/errors";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { Category } from "../../entities/Category";
import { CategoryModel, ICategoryDocument } from "../../models/CategoryModel";
import { CategoryFilters, ICategoryRepository } from "./ICategoryRepository";

export class CategoryRepository implements ICategoryRepository {
  private toEntity(doc: ICategoryDocument): Category {
    return new Category({
      id: doc._id,
      name: doc.name,
      emoji: doc.emoji,
      color: doc.color,
      type: doc.type,
      userId: doc.userId,
    });
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Category>> {
    const { limit, offset, cursor } = pagination;
    const filter = { ...baseFilter };
    if (cursor) {
      filter._id = { $gt: cursor };
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
      deletedAt: null,
    }).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Category>> {
    return this.paginatedFind({ deletedAt: null }, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: CategoryFilters,
  ): Promise<PaginatedResult<Category>> {
    const filter: Record<string, unknown> = { userId, deletedAt: null };
    if (filters?.ids?.length) {
      filter._id = { $in: filters.ids };
    }
    if (filters?.type) {
      filter.type = filters.type;
    }
    return this.paginatedFind(filter, pagination);
  }

  async create(category: Partial<Category>): Promise<Category> {
    const id = uuidv7();
    const doc = await CategoryModel.create({ _id: id, ...category });
    return this.toEntity(doc);
  }

  async createMany(categories: Partial<Category>[]): Promise<Category[]> {
    const docs = await CategoryModel.insertMany(
      categories.map((c) => ({ _id: uuidv7(), ...c })),
    );
    return docs.map((doc) => this.toEntity(doc as unknown as ICategoryDocument));
  }

  async update(id: string, category: Partial<Category>): Promise<Category> {
    const doc = await CategoryModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
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
      { _id: id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Category not found");
    }
  }
}
