import { Request, Response } from "express";
import repositoryFactory from "../factories/RepositoryFactory";
import { CategoryService } from "../services/CategoryService";

const categoryService = new CategoryService(
  repositoryFactory.getCategoryRepository(),
);

export class CategoryController {
  static getAllCategories = async (_req: Request, res: Response) => {
    const categories = await categoryService.getAllCategories();
    res.status(200).json(categories);
  };

  static getCategoryById = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const category = await categoryService.getCategoryById(id);
    res.status(200).json(category);
  };

  static createCategory = async (req: Request, res: Response) => {
    const newCategory = await categoryService.createCategory(req.body);
    res.status(201).json(newCategory);
  };

  static updateCategory = async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const updatedCategory = await categoryService.updateCategory(id, req.body);
    res.status(200).json(updatedCategory);
  };

  static deleteCategory = async (req: Request, res: Response) => {
    await categoryService.deleteCategory(req.params.id as string);
    res.status(204).send();
  };
}
