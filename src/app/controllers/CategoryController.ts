import { Request, Response } from "express";
import repositoryFactory from "../factories/RepositoryFactory";
import { CategoryService } from "../services/CategoryService";
import { asyncHandler } from "../../shared/asyncHandler";

const categoryService = new CategoryService(
  repositoryFactory.getCategoryRepository(),
);

export class CategoryController {
  static getAllCategories = asyncHandler(
    async (_req: Request, res: Response) => {
      const categories = await categoryService.getAllCategories();
      res.status(200).json(categories);
    },
  );

  static getCategoryById = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const category = await categoryService.getCategoryById(Number(id));
    res.status(200).json(category);
  });

  static createCategory = asyncHandler(async (req: Request, res: Response) => {
    const newCategory = await categoryService.createCategory(req.body);
    res.status(201).json(newCategory);
  });

  static updateCategory = asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const updatedCategory = await categoryService.updateCategory(id, req.body);
    res.status(200).json(updatedCategory);
  });

  static deleteCategory = asyncHandler(async (req: Request, res: Response) => {
    await categoryService.deleteCategory(Number(req.params.id));
    res.status(204).send();
  });
}
