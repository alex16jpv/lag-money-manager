import { Router } from "express";
import { CategoryController } from "../controllers/CategoryController";
import { validate } from "../validation/validate";
import {
  createCategorySchema,
  updateCategorySchema,
  idParamSchema,
} from "../validation/schemas";

const router = Router();

router.get("/", CategoryController.getAllCategories);
router.post(
  "/",
  validate(createCategorySchema),
  CategoryController.createCategory,
);
router.get("/:id", validate(idParamSchema), CategoryController.getCategoryById);
router.put(
  "/:id",
  validate(updateCategorySchema),
  CategoryController.updateCategory,
);
router.delete(
  "/:id",
  validate(idParamSchema),
  CategoryController.deleteCategory,
);

export default router;
