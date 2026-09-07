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
 *     description: |
 *       Buckets are computed in the user's timezone (from the token claim), so
 *       a day boundary is their midnight, not UTC's. Deleted transactions are
 *       excluded, and ADJUSTMENT ones only appear when asked for explicitly
 *       with `type=ADJUSTMENT` (they are balance reconciliations, not spending).
 *
 *       Bucket semantics: `groupBy=day` comes back ascending by date and skips
 *       days without transactions (the client fills the gaps); the other
 *       groupings come back by total descending. With `groupBy=tag` a
 *       multi-tag transaction contributes to EVERY one of its tag buckets, so
 *       the buckets can add up to more than `total` — `total` is always the
 *       real, non-double-counted sum. Transactions without tags land in the
 *       `untagged` bucket and those without a category in `uncategorized`.
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [category, day, tag], default: category }
 *         description: Bucket dimension
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [INCOME, EXPENSE, TRANSFER, ADJUSTMENT], default: EXPENSE }
 *         description: Transaction type to aggregate
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Start of the range, inclusive (ISO 8601, offsets accepted)
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: End of the range, EXCLUSIVE — the range is half-open [from, to)
 *     responses:
 *       200:
 *         description: Spending buckets with totals
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StatsResponse'
 *       400:
 *         description: Invalid query parameters, including from later than to (code VALIDATION)
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
  "/spending",
  validate(spendingStatsSchema),
  StatsController.getSpending,
);

export default router;
