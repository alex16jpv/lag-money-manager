import { NextFunction, Request, Response } from "express";
import repositoryFactory from "../factories/RepositoryFactory";
import { CategoryService } from "../services/CategoryService";

const categoryService = new CategoryService(
  repositoryFactory.getCategoryRepository(),
);

export class CategoryController {
  static async getAllCategories(
    req: Request,
    res: Response,
    next: NextFunction,
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
    next: NextFunction,
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
      const newCategory = await categoryService.createCategory(req.body);
      res.status(201).json(newCategory);
    } catch (error) {
      next(error);
    }
  }

  static async updateCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const updatedCategory = await categoryService.updateCategory(
        id,
        req.body,
      );
      res.status(200).json(updatedCategory);
    } catch (error) {
      next(error);
    }
  }

  static async deleteCategory(req: Request, res: Response, next: NextFunction) {
    try {
      await categoryService.deleteCategory(Number(req.params.id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
