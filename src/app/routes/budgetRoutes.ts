import { Router } from "express";

import { BudgetController } from "../controllers/BudgetController";
import {
  budgetAmountOverrideSchema,
  budgetIdParamSchema,
  createBudgetSchema,
  getBudgetsSchema,
  updateBudgetSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /budgets:
 *   get:
 *     tags: [Budgets]
 *     summary: List budgets with spend for the reference period
 *     description: |
 *       Each budget comes back as a view with its period window (`periodFrom`/`periodTo`,
 *       half-open), the `amount` resolved for that period (override ?? baseAmount) and the
 *       `spent` in it. The period is the one containing `reference` (default: now) in the
 *       user's timezone. Excluded by default: archived budgets, expired CUSTOM budgets
 *       (their fixed window already ended; recurring period types never expire), and
 *       budgets whose reference period predates their `effectiveFrom`. These filters apply
 *       AFTER pagination, so a page can hold fewer than `limit` items even when
 *       `pagination.hasMore` is true — follow `hasMore`/`nextCursor`, not `data.length`.
 *     parameters:
 *       - in: query
 *         name: reference
 *         schema: { type: string, format: date-time }
 *         description: "Any instant inside the period to resolve (default: now)"
 *       - in: query
 *         name: includeArchived
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Also include archived budgets
 *       - in: query
 *         name: includeExpired
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Also include expired CUSTOM budgets
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *         description: Maximum number of items to return
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *         description: Number of items to skip (offset-based pagination)
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *         description: ID of the last item of the previous page (cursor-based pagination; overrides offset)
 *     responses:
 *       200:
 *         description: Paginated list of budget views
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BudgetList'
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [Budgets]
 *     summary: Create a budget
 *     description: |
 *       An empty `categoryIds` creates a GLOBAL budget over ALL spending of the period
 *       (uncategorized and quick-adds included); only one global budget per period type
 *       can exist. `periodStartDate`/`periodEndDate` are required with `periodType=CUSTOM`
 *       and rejected for any other period type. `currency` is stamped from the user.
 *     parameters:
 *       - in: query
 *         name: reference
 *         schema: { type: string, format: date-time }
 *         description: "Period to resolve amount/spent in the response (default: now)"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBudgetInput'
 *     responses:
 *       201:
 *         description: Budget created (view resolved for the reference period)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Budget'
 *       400:
 *         description: Validation error. Codes include BUDGET_PERIOD_OVERLAP (a budget for this category and period type already exists), CATEGORY_ARCHIVED, CATEGORY_TYPE_MISMATCH.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: A referenced category was not found (or not owned by the user)
 *       409:
 *         description: Concurrent duplicate creation lost the race to the unique index (code DUPLICATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/", validate(getBudgetsSchema), BudgetController.getAllBudgets);
router.post("/", validate(createBudgetSchema), BudgetController.createBudget);

/**
 * @openapi
 * /budgets/{id}:
 *   get:
 *     tags: [Budgets]
 *     summary: Get a budget by ID
 *     description: |
 *       Always responds for owned budgets: archived ones stay readable (with `archivedAt`
 *       set) and expired CUSTOM ones come back with `expired: true`.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Budget ID
 *       - in: query
 *         name: reference
 *         schema: { type: string, format: date-time }
 *         description: "Any instant inside the period to resolve (default: now)"
 *     responses:
 *       200:
 *         description: Budget view resolved for the reference period
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Budget'
 *       400:
 *         description: Invalid ID or reference
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Budget not found
 *   put:
 *     tags: [Budgets]
 *     summary: Update a budget
 *     description: |
 *       Partial update. Changing `periodType` clears all amount overrides (their keys are
 *       period-type-specific) and, when moving away from CUSTOM, the CUSTOM dates. Moving
 *       a CUSTOM window (`periodStartDate`/`periodEndDate`) also clears its overrides.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Budget ID
 *       - in: query
 *         name: reference
 *         schema: { type: string, format: date-time }
 *         description: "Period to resolve amount/spent in the response (default: now)"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateBudgetInput'
 *     responses:
 *       200:
 *         description: Budget updated (view resolved for the reference period)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Budget'
 *       400:
 *         description: Validation error. Codes include RESOURCE_ARCHIVED (writing to an archived budget), BUDGET_PERIOD_OVERLAP, CATEGORY_ARCHIVED (assigning an archived category; keeping one it already had is allowed), CATEGORY_TYPE_MISMATCH.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Budget or referenced category not found (or not owned by the user)
 *   delete:
 *     tags: [Budgets]
 *     summary: Archive a budget
 *     description: |
 *       Soft delete; the budget stays readable via GET /budgets/{id}. Idempotent —
 *       archiving an already-archived budget is a no-op success. There is no restore
 *       endpoint: to recover, create a new budget.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Budget ID
 *       - in: query
 *         name: reference
 *         schema: { type: string, format: date-time }
 *         description: Accepted for uniformity; not used by this operation
 *     responses:
 *       200:
 *         description: Budget archived (or already archived)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Invalid ID or reference
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Budget not found
 */
router.get(
  "/:id",
  validate(budgetIdParamSchema),
  BudgetController.getBudgetById,
);
router.put("/:id", validate(updateBudgetSchema), BudgetController.updateBudget);
router.delete(
  "/:id",
  validate(budgetIdParamSchema),
  BudgetController.deleteBudget,
);

/**
 * @openapi
 * /budgets/{id}/amount:
 *   put:
 *     tags: [Budgets]
 *     summary: Override the budget amount for the reference period
 *     description: |
 *       Sets a per-period amount without touching `baseAmount`: "this month I
 *       budget more/less than usual". Only the period containing `reference` is
 *       affected; every other period keeps the base. `amount: 0` is allowed and
 *       means "this budget does not apply this period" (it is NOT the same as
 *       removing the override). The response view comes back with
 *       `hasOverride: true`.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Budget ID
 *       - in: query
 *         name: reference
 *         schema: { type: string, format: date-time }
 *         description: "Any instant inside the period to override (default: now)"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BudgetAmountOverrideInput'
 *     responses:
 *       200:
 *         description: Override applied (view resolved for the reference period)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Budget'
 *       400:
 *         description: Validation error, or RESOURCE_ARCHIVED when the budget is archived
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Budget not found
 */
router.put(
  "/:id/amount",
  validate(budgetAmountOverrideSchema),
  BudgetController.setAmountOverride,
);

/**
 * @openapi
 * /budgets/{id}/amount:
 *   delete:
 *     tags: [Budgets]
 *     summary: Remove the override for the reference period (back to baseAmount)
 *     description: |
 *       Drops the override for the period containing `reference`, so the period
 *       falls back to `baseAmount` and the view reports `hasOverride: false`.
 *       Removing a non-existent override is a no-op success.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Budget ID
 *       - in: query
 *         name: reference
 *         schema: { type: string, format: date-time }
 *         description: "Any instant inside the period whose override is removed (default: now)"
 *     responses:
 *       200:
 *         description: Override removed (view resolved for the reference period)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Budget'
 *       400:
 *         description: Invalid ID or reference, or RESOURCE_ARCHIVED when the budget is archived
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Budget not found
 */
router.delete(
  "/:id/amount",
  validate(budgetIdParamSchema),
  BudgetController.clearAmountOverride,
);

export default router;
