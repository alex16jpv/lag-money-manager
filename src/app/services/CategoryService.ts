import { Category } from "../../domain/entities/Category";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { ApiError } from "../../shared/errors";

export class CategoryService {
  constructor(private repo: ICategoryRepository) {
    this.repo = repo;
  }

  async getAllCategories() {
    const categories = await this.repo.getAll();
    return categories?.map((category) => new Category(category));
  }

  async getCategoryById(id: number) {
    const category = await this.repo.getById(id);
    if (!category) {
      throw new ApiError("NotFound", "Category not found");
    }
    return new Category(category);
  }

  async createCategory(category: Category) {
    const categoryToCreate = new Category(category);
    categoryToCreate.validate();
    return this.repo.create(categoryToCreate);
  }
}
