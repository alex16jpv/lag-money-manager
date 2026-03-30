import { Op, WhereOptions } from "sequelize";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { Category } from "../../entities/Category";
import { CategoryModel } from "../../models/sequelize/CategoryModel";
import { ICategoryRepository } from "./ICategoryRepository";

export class CategorySeqRepository implements ICategoryRepository {
  private readonly model: typeof CategoryModel;

  constructor() {
    this.model = CategoryModel;
  }

  private async paginatedFindAll(
    baseWhere: WhereOptions,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Category>> {
    const { limit, offset, cursor } = pagination;
    const where: WhereOptions = cursor
      ? { ...baseWhere, id: { [Op.gt]: cursor } }
      : baseWhere;

    const [{ rows }, total] = await Promise.all([
      this.model.findAndCountAll({
        where,
        order: [["id", "ASC"]],
        limit,
        offset: cursor ? 0 : offset,
      }),
      this.model.count({ where: baseWhere }),
    ]);

    const data = rows.map((result) => new Category(result.toJSON()));
    return buildPaginatedResult(data, total, pagination);
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Category>> {
    return this.paginatedFindAll({}, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Category>> {
    return this.paginatedFindAll({ userId }, pagination);
  }

  async getById(id: string): Promise<Category | null> {
    const result = await this.model.findByPk(id);
    if (!result) {
      return null;
    }
    return new Category(result.toJSON());
  }

  async create(category: Partial<Category>): Promise<Category> {
    const result = await this.model.create(category);
    return new Category(result.toJSON());
  }

  async update(id: string, category: Partial<Category>): Promise<Category> {
    const categoryToUpdate = await this.model.findByPk(id);
    if (!categoryToUpdate) {
      throw new ApiError("NotFound", "Category not found");
    }
    await categoryToUpdate.update(category);
    await categoryToUpdate.reload();
    return new Category(categoryToUpdate.toJSON());
  }

  async delete(id: string): Promise<void> {
    const category = await this.model.findByPk(id);
    if (!category) {
      throw new ApiError("NotFound", "Category not found");
    }
    await category.destroy();
  }
}
