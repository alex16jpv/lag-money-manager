import { Category } from "../../entities/Category";

export interface ICategoryRepository {
  getAll(): Promise<Category[]>;
  getById(id: number): Promise<Category | null>;
  create(category: Partial<Category>): Promise<Category>;
  delete(id: number): Promise<void>;
  update(category: Partial<Category>): Promise<Category>;
}
