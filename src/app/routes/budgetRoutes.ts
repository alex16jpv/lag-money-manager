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
 *     parameters:
 *       - in: query
 *         name: reference
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: includeArchived
 *         schema: { type: string, enum: ["true", "false"] }
 *     responses:
 *       200: { description: Budgets with spent }
 *   post:
 *     tags: [Budgets]
 *     summary: Create a budget
 *     responses:
 *       201: { description: Budget created }
 *       400: { description: Validation error or duplicate }
 */
router.get("/", validate(getBudgetsSchema), BudgetController.getAllBudgets);
router.post("/", validate(createBudgetSchema), BudgetController.createBudget);

router.get("/:id", validate(budgetIdParamSchema), BudgetController.getBudgetById);
router.put("/:id", validate(updateBudgetSchema), BudgetController.updateBudget);
router.delete("/:id", validate(budgetIdParamSchema), BudgetController.deleteBudget);

/**
 * @openapi
 * /budgets/{id}/amount:
 *   put:
 *     tags: [Budgets]
 *     summary: Override the budget amount for the reference period
 *     responses:
 *       200: { description: Override applied }
 */
router.put(
  "/:id/amount",
  validate(budgetAmountOverrideSchema),
  BudgetController.setAmountOverride,
);

export default router;
