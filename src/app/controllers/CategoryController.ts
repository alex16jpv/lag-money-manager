import { Request, Response } from "express";
import repositoryFactory from "../factories/RepositoryFactory";
import { CategoryService } from "../services/CategoryService";
import { extractPagination } from "../../shared/pagination";
import { CategoryFilters } from "../../domain/repositories/category/ICategoryRepository";

const categoryService = new CategoryService(
  repositoryFactory.getCategoryRepository(),
);

export class CategoryController {
  static getAllCategories = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const filters: CategoryFilters = {};
    if (req.query.ids) {
      filters.ids = req.query.ids as string[];
    }
    const result = await categoryService.getAllCategories(
      userId,
      extractPagination(req),
      filters,
    );
    res.status(200).json(result);
  };

  static getCategoryById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const category = await categoryService.getCategoryById(id, userId);
    res.status(200).json(category);
  };

  static createCategory = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const newCategory = await categoryService.createCategory({
      ...req.body,
      userId,
    });
    res.status(201).json(newCategory);
  };

  static updateCategory = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const updatedCategory = await categoryService.updateCategory(
      id,
      req.body,
      userId,
    );
    res.status(200).json(updatedCategory);
  };

  static deleteCategory = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    await categoryService.deleteCategory(req.params.id as string, userId);
    res.status(204).send();
  };
}
