import { Category } from "../../domain/entities/Category";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { ApiError } from "../../shared/errors";

export class CategoryService {
  constructor(private repo: ICategoryRepository) {
    this.repo = repo;
  }

  async getAllCategories(): Promise<Category[]> {
    const categories = await this.repo.getAll();
    return categories?.map((category) => new Category(category));
  }

  async getCategoryById(id: number): Promise<Category> {
    const category = await this.repo.getById(id);
    if (!category) {
      throw new ApiError("NotFound", "Category not found");
    }
    return new Category(category);
  }

  async createCategory(category: Category): Promise<Category> {
    const categoryToCreate = new Category(category);
    categoryToCreate.validate();
    return this.repo.create(categoryToCreate);
  }

  async updateCategory(
    id: number,
    category: Partial<Category>,
  ): Promise<Category> {
    if (category?.id && category.id !== id) {
      throw new ApiError("BadRequest", "Category id does not match");
    }
    return await this.repo.update(id, category);
  }

  async deleteCategory(id: number): Promise<void> {
    return await this.repo.delete(id);
  }
}
