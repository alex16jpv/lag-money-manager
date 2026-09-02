import { Router } from "express";

import { CategoryController } from "../controllers/CategoryController";
import {
  createCategorySchema,
  getCategoriesSchema,
  idParamSchema,
  updateCategorySchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /categories:
 *   get:
 *     tags: [Categories]
 *     summary: Get all categories
 *     description: Archived categories are hidden unless includeArchived=true.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Maximum number of items to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of items to skip (offset-based pagination)
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Cursor ID for cursor-based pagination (overrides offset)
 *       - in: query
 *         name: ids
 *         schema:
 *           type: string
 *         description: Comma-separated list of category UUIDs to filter by ID (1-100)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [INCOME, EXPENSE, TRANSFER]
 *         description: Filter categories by type
 *       - in: query
 *         name: includeArchived
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Include archived categories in the listing
 *     responses:
 *       200:
 *         description: Paginated list of categories
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CategoryList'
 *       400:
 *         description: Invalid query parameters (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/",
  validate(getCategoriesSchema),
  CategoryController.getAllCategories,
);

/**
 * @openapi
 * /categories:
 *   post:
 *     tags: [Categories]
 *     summary: Create a new category
 *     description: >
 *       Active category names are unique per user, case-insensitively
 *       ("Comida" = "comida"; accents still distinct).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCategoryInput'
 *     responses:
 *       201:
 *         description: Category created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Category'
 *       400:
 *         description: Validation error (code VALIDATION) or category limit reached (code CATEGORY_LIMIT_REACHED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An active category with this name already exists (code DUPLICATE, case-insensitive)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
/**
 * @openapi
 * /categories/restore-defaults:
 *   post:
 *     tags: [Categories]
 *     summary: Recreate the missing default categories (idempotent by seedKey)
 *     description: >
 *       Creates only the missing defaults. Archived seed categories count as
 *       present and renamed ones keep their seedKey, so neither is duplicated.
 *     responses:
 *       200:
 *         description: Newly created defaults (empty array when none were missing)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RestoreDefaultsResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/restore-defaults", CategoryController.restoreDefaults);

router.post(
  "/",
  validate(createCategorySchema),
  CategoryController.createCategory,
);

/**
 * @openapi
 * /categories/{id}:
 *   get:
 *     tags: [Categories]
 *     summary: Get a category by ID
 *     description: >
 *       Also resolves archived categories (archivedAt tells them apart);
 *       only the listing hides them by default.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Category ID
 *     responses:
 *       200:
 *         description: Category found (may be archived)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Category'
 *       400:
 *         description: Invalid ID format (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Category not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id", validate(idParamSchema), CategoryController.getCategoryById);

/**
 * @openapi
 * /categories/{id}:
 *   put:
 *     tags: [Categories]
 *     summary: Update a category
 *     description: >
 *       Partial update. `type` becomes immutable once the category has
 *       transactions (changing it would reclassify history). Renaming keeps the
 *       case-insensitive uniqueness rule, and a seeded category keeps its
 *       seedKey when renamed.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Category ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateCategoryInput'
 *     responses:
 *       200:
 *         description: Category updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Category'
 *       400:
 *         description: Validation error (code VALIDATION), writing to an archived category (code RESOURCE_ARCHIVED) or changing the type of a category with transactions (code CATEGORY_TYPE_LOCKED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Category not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Another active category already uses this name (code DUPLICATE, case-insensitive)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put(
  "/:id",
  validate(updateCategorySchema),
  CategoryController.updateCategory,
);

/**
 * @openapi
 * /categories/{id}:
 *   delete:
 *     tags: [Categories]
 *     summary: Archive a category
 *     description: >
 *       Soft delete — the category stays readable by id and its transactions
 *       keep pointing at it. Allowed even with linked transactions. Idempotent:
 *       archiving an already-archived category is a no-op success.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Category ID
 *     responses:
 *       200:
 *         description: Category archived (or already archived)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Invalid ID format (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Category not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete(
  "/:id",
  validate(idParamSchema),
  CategoryController.deleteCategory,
);

/**
 * @openapi
 * /categories/{id}/restore:
 *   post:
 *     tags: [Categories]
 *     summary: Restore an archived category
 *     description: >
 *       Idempotent — restoring an already-active category returns it unchanged.
 *       Fails with 409 when another active category took its name meanwhile.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Category ID
 *     responses:
 *       200:
 *         description: Category restored (or already active)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Category'
 *       400:
 *         description: Invalid ID format (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Category not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An active category already uses this name (code DUPLICATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/restore",
  validate(idParamSchema),
  CategoryController.restoreCategory,
);

export default router;
