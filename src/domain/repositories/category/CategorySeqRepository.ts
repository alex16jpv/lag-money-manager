import { ApiError } from "../../../shared/errors";
import { Category } from "../../entities/Category";
import { CategoryModel } from "../../models/sequelize/CategoryModel";
import { ICategoryRepository } from "./ICategoryRepository";

export class CategorySeqRepository implements ICategoryRepository {
  model: typeof CategoryModel;

  constructor() {
    this.model = CategoryModel;
  }

  async getAll(): Promise<Category[]> {
    const results = await this.model.findAll();
    return results.map((result) => new Category(result.toJSON()));
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
