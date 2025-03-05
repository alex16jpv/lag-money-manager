import { NextFunction, Request, Response } from "express";
import repositoryFactory from "../factories/RepositoryFactory";
import { CategoryService } from "../services/CategoryService";

const categoryService = new CategoryService(
  repositoryFactory.getCategoryRepository()
);

export class CategoryController {
  static async getAllCategories(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const categories = await categoryService.getAllCategories();
      res.status(200).json(categories);
    } catch (error) {
      next(error);
    }
  }

  static async getCategoryById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { id } = req.params;
      const category = await categoryService.getCategoryById(Number(id));
      res.status(200).json(category);
    } catch (error) {
      next(error);
    }
  }

  static async createCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const category = req.body;
      const newCategory = await categoryService.createCategory(category);
      res.status(201).json(newCategory);
    } catch (error) {
      next(error);
    }
  }
}
