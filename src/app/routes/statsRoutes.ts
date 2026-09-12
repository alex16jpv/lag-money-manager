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
 *     summary: Aggregate spending by category, day, month, account or tag
 *     description: |
 *       A `day` bucket is the transaction's own accounting day (`dayKey`),
 *       frozen when it was written, so a later change of the account's time
 *       zone cannot move past spending between buckets or months; the zone
 *       (from the token claim) resolves the days the range covers. Deleted
 *       transactions are excluded, and ADJUSTMENT ones only appear when asked
 *       for explicitly with `type=ADJUSTMENT` (they are balance
 *       reconciliations, not spending).
 *
 *       Bucket semantics: `groupBy=day` and `groupBy=month` come back ascending
 *       by key and skip the days or months without transactions (the client
 *       fills the gaps); the other groupings come back by total descending,
 *       ties broken by key. With `groupBy=tag` a multi-tag transaction
 *       contributes to EVERY one of its tag buckets, so the buckets can add up
 *       to more than `total` — `total` is always the real, non-double-counted
 *       sum. Transactions without tags land in the `untagged` bucket and those
 *       without a category in `uncategorized`.
 *
 *       A `month` bucket is the first seven characters of the same frozen
 *       accounting day, so a month and its days can never disagree about where
 *       a row belongs. An `account` bucket is the account the money left —
 *       `fromAccountId` — except for INCOME and for an increase-only
 *       ADJUSTMENT, which only have the other side. Every type the API accepts
 *       carries at least one account, so the `unassigned` bucket only ever
 *       holds a row written before that was enforced.
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [category, day, month, account, tag], default: category }
 *         description: Bucket dimension
 *       - in: query
 *         name: splitBy
 *         schema: { type: string, enum: [category] }
 *         description: >
 *           Adds a second dimension INSIDE each bucket (`splits`), so one
 *           request answers "per category and month" instead of twelve. Only
 *           with `groupBy=month` or `account`, and only with `from` and `to`:
 *           `category` is that dimension already, `tag` unwinds each row into
 *           several buckets, and `day` would grow a split per category per day
 *           of the window. Those two are bounded — months fit in a window, and
 *           a user has a handful of accounts.
 *       - in: query
 *         name: categoryIds
 *         schema: { type: string }
 *         description: >
 *           Comma-separated category ids (at most 20): aggregates only those.
 *           A budget of several categories is one request, not one per category.
 *           Rows with no category never match it, quick-adds included.
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
 *         description: >
 *           End of the range, EXCLUSIVE — the range is half-open [from, to) and
 *           is matched as the whole calendar days it covers.
 *     responses:
 *       200:
 *         description: Spending buckets with totals
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StatsResponse'
 *       400:
 *         description: >
 *           Invalid query parameters (code VALIDATION): from later than to, a
 *           categoryIds that is not a list of at most 20 uuids, a splitBy over
 *           a grouping that cannot take one, or a splitBy with no from/to.
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
