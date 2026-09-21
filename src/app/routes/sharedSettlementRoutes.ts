import { Router } from "express";

import { SharedSettlementController } from "../controllers/SharedSettlementController";
import {
  createSettlementSchema,
  getSettlementsSchema,
  idParamSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /settlements:
 *   get:
 *     tags: [Settlements]
 *     summary: The money that has changed hands with the people you split with
 *     description: >
 *       Newest first, keyset over `(date, id)`. Narrow it to one counterparty
 *       with `contactId`, or with `expenseId` for the block of guests that
 *       lives in that expense.
 *     parameters:
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
 *         description: ID of the last item of the previous page (overrides offset)
 *       - in: query
 *         name: contactId
 *         schema: { type: string, format: uuid }
 *         description: Only what has changed hands with this person
 *       - in: query
 *         name: expenseId
 *         schema: { type: string, format: uuid }
 *         description: Only what has changed hands with that expense's block of guests
 *     responses:
 *       200:
 *         description: Paginated list of payments
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SettlementList'
 *       400:
 *         description: Invalid query parameters (code VALIDATION), or a cursor that names no payment of the caller's (code INVALID_CURSOR)
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
  validate(getSettlementsSchema),
  SharedSettlementController.getSettlements,
);

/**
 * @openapi
 * /settlements:
 *   post:
 *     tags: [Settlements]
 *     summary: Settle up with one person, or with one block of guests
 *     description: >
 *       One payment, with both halves: `collected` is what came back to you
 *       and `paid` is what you handed over. **What it covers is imputed to the
 *       oldest line first**, across every group you share with them, and the
 *       answer says line by line what it covered.
 *
 *       **Money coming back is not income.** It arrives in `accountId` as a
 *       `SETTLEMENT`, carries no category and is out of Stats and of the
 *       budgets — the shape an `ADJUSTMENT` already has. What it covers comes
 *       off what counts as yours on each line it lands on, **in the month that
 *       line happened**, and every movement it touches says so in its history.
 *
 *       **Paying somebody back is not that movement: it is your expense**, one
 *       for each line you cover, with that line's description, dated that
 *       line, and with the category you give — one in `categoryId` for all of
 *       them, or one per line in `categories`. The shared layer carries no
 *       categories, so there is none to take. Whatever is left of `paid` once
 *       every line you owe is covered is a **refund** of what they paid ahead,
 *       and that is a `SETTLEMENT` leaving the account: you never spent it, so
 *       it carries no category either.
 *
 *       **`outsideApp` is cash the app never saw**: no movement is written and
 *       no balance moves, and what is owed falls all the same, because that
 *       money did change hands.
 *
 *       Accepts a client-minted `id`, with the usual replay.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSettlementInput'
 *     responses:
 *       200:
 *         description: Replay of a payment already recorded with this client-minted id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SettlementResult'
 *       201:
 *         description: The payment, and what it covered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SettlementResult'
 *       400:
 *         description: Validation error (code VALIDATION), more than you owe them and more than they paid ahead (code SETTLEMENT_OVER_PAID), decimals in a `ZeroDecimalCurrency` (code AMOUNT_PRECISION), a date more than 24h ahead (code FUTURE_DATE), an archived category (code CATEGORY_ARCHIVED) or one of another type (code CATEGORY_TYPE_MISMATCH)
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
 *         description: The contact, the expense or the account is not the caller's (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The client-minted id is already in use (code ID_TAKEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/",
  validate(createSettlementSchema),
  SharedSettlementController.createSettlement,
);

/**
 * @openapi
 * /settlements/{id}:
 *   get:
 *     tags: [Settlements]
 *     summary: Get one payment
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: The payment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Settlement'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Payment not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:id",
  validate(idParamSchema),
  SharedSettlementController.getSettlementById,
);

/**
 * @openapi
 * /settlements/{id}:
 *   delete:
 *     tags: [Settlements]
 *     summary: Undo a payment (soft delete)
 *     description: >
 *       Reverses every movement it recorded — the collection, your expenses
 *       and any refund — and imputes what is left over the lines that are
 *       still open. Idempotent. The movements themselves cannot be deleted on
 *       their own: this is the door.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Payment ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     responses:
 *       200:
 *         description: The undone payment (also when it was already undone)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Settlement'
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
 *         description: Payment not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete(
  "/:id",
  validate(idParamSchema),
  SharedSettlementController.deleteSettlement,
);

export default router;
