import { Router } from "express";

import { StatsController } from "../controllers/StatsController";
import { spendingStatsSchema } from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /stats/spending:
 *   get:
 *     tags: [Stats]
 *     summary: Aggregate spending grouped by category, day or tag
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [category, day, tag] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [INCOME, EXPENSE, TRANSFER] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200: { description: Spending buckets with totals }
 */
router.get("/spending", validate(spendingStatsSchema), StatsController.getSpending);

export default router;
