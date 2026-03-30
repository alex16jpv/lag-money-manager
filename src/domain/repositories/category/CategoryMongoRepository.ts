import { v7 as uuidv7 } from "uuid";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { Category } from "../../entities/Category";
import { CategoryMongoModel } from "../../models/mongoose/CategoryMongoModel";
import { ICategoryRepository } from "./ICategoryRepository";

export class CategoryMongoRepository implements ICategoryRepository {
  private toEntity(doc: {
    _id: string;
    name: string;
    userId: string;
  }): Category {
    return new Category({ id: doc._id, name: doc.name, userId: doc.userId });
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
      CategoryMongoModel.find(filter)
        .sort({ _id: 1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      CategoryMongoModel.countDocuments(baseFilter),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async getById(id: string): Promise<Category | null> {
    const doc = await CategoryMongoModel.findById(id).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Category>> {
    return this.paginatedFind({}, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Category>> {
    return this.paginatedFind({ userId }, pagination);
  }

  async create(category: Partial<Category>): Promise<Category> {
    const id = uuidv7();
    const doc = await CategoryMongoModel.create({ _id: id, ...category });
    return this.toEntity(doc);
  }

  async update(id: string, category: Partial<Category>): Promise<Category> {
    const doc = await CategoryMongoModel.findByIdAndUpdate(id, category, {
      new: true,
    }).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Category not found");
    }
    return this.toEntity(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await CategoryMongoModel.findByIdAndDelete(id);
    if (!doc) {
      throw new ApiError("NotFound", "Category not found");
    }
  }
}
