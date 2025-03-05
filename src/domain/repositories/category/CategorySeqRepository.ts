import { Category } from "../../entities/Category";
import { CategoryModel } from "../../models/Category";
import { ICategoryRepository } from "./ICategoryRepository";

export class CategorySeqRepository implements ICategoryRepository {
  model: typeof CategoryModel;

  constructor() {
    this.model = CategoryModel;
  }

  getAll(): Promise<Category[]> {
    return this.model.findAll();
  }

  getById(id: number): Promise<Category | null> {
    return this.model.findByPk(id);
  }

  create(category: Partial<Category>): Promise<Category> {
    return this.model.create(category);
  }

  delete(id: number): Promise<void> {
    throw new Error("Method not implemented.");
  }

  update(category: Partial<Category>): Promise<Category> {
    throw new Error("Method not implemented.");
  }
}
