import { Category } from "../../domain/entities/Category";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { ApiError } from "../../shared/errors";
import { CreateCategoryDTO, UpdateCategoryDTO } from "../dtos/CategoryDTO";

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

  async createCategory(dto: CreateCategoryDTO): Promise<Category> {
    const category = new Category(dto);
    category.validate();
    return this.repo.create(category);
  }

  async updateCategory(id: number, dto: UpdateCategoryDTO): Promise<Category> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Category id does not match");
    }
    return await this.repo.update(id, dto);
  }

  async deleteCategory(id: number): Promise<void> {
    return await this.repo.delete(id);
  }
}
