import { Router } from "express";

import { TransactionController } from "../controllers/TransactionController";
import {
  createTransactionSchema,
  getTransactionsSchema,
  idParamSchema,
  quickAddTransactionSchema,
  updateTransactionSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /transactions:
 *   get:
 *     tags: [Transactions]
 *     summary: Get all transactions
 *     description: |
 *       Paginated listing sorted by date descending. For infinite scroll use
 *       cursor pagination (`cursor` = `pagination.nextCursor` of the previous
 *       page); it stays consistent when transactions are backdated.
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
 *         description: ID of the last item of the previous page (cursor-based pagination; overrides offset)
 *       - in: query
 *         name: ids
 *         schema:
 *           type: string
 *         description: Comma-separated list of UUIDs to filter by ID (max 100)
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter transactions by account ID (matches fromAccountId or toAccountId)
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter transactions by category ID
 *       - in: query
 *         name: uncategorized
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Only transactions without a category. Cannot be combined with categoryId.
 *       - in: query
 *         name: pendingDetails
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Filter by the pendingDetails flag (true = quick-adds awaiting detailing)
 *       - in: query
 *         name: source
 *         schema: { type: string, enum: [MANUAL, QUICK, IMPORT] }
 *         description: Only transactions created through this channel (QUICK = quick-add)
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Start of the date range, inclusive (half-open range [from, to))
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: End of the date range, exclusive (half-open range [from, to))
 *       - in: query
 *         name: includeSummary
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Adds summary.totalAmount, the sum over the whole filtered set (one extra aggregation, so opt-in)
 *       - in: query
 *         name: tag
 *         schema: { type: string }
 *         description: Only transactions carrying this tag (tags are stored trimmed and lowercased)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [INCOME, EXPENSE, TRANSFER, ADJUSTMENT]
 *         description: Filter transactions by type
 *     responses:
 *       200:
 *         description: Paginated list of transactions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransactionList'
 *       400:
 *         description: Invalid query. Codes include INVALID_CURSOR (unknown or foreign cursor id); combining uncategorized=true with categoryId is rejected.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/",
  validate(getTransactionsSchema),
  TransactionController.getAllTransactions,
);

/**
 * @openapi
 * /transactions:
 *   post:
 *     tags: [Transactions]
 *     summary: Create a new transaction (income, expense, transfer, or adjustment)
 *     description: |
 *       Creates a transaction and updates account balances atomically.
 *       - **INCOME**: Adds amount to `toAccountId` (required; `fromAccountId` not allowed).
 *       - **EXPENSE**: Subtracts amount from `fromAccountId` (required; `toAccountId` not allowed).
 *       - **TRANSFER**: Subtracts from `fromAccountId` and adds to `toAccountId` (both required, must differ).
 *       - **ADJUSTMENT**: Balance reconciliation; exactly one of `fromAccountId` (decrease) or `toAccountId` (increase), no `categoryId`. Excluded from spending stats and budgets.
 *
 *       The server stamps `currency` (from the involved account) and `source`; client-sent values are ignored.
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema:
 *           type: string
 *           pattern: "^[A-Za-z0-9_-]{1,200}$"
 *         description: |
 *           Optional retry-safety key (1-200 chars of [A-Za-z0-9_-], typically a UUID
 *           per create action). Retrying with the same key and payload returns the
 *           already-created transaction instead of a duplicate. Keys expire after 24 hours.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTransactionInput'
 *     responses:
 *       201:
 *         description: Transaction created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Validation error. Codes include FUTURE_DATE (date more than 24h in the future), CURRENCY_MISMATCH (transfer between accounts with different currencies), CATEGORY_ARCHIVED, CATEGORY_TYPE_MISMATCH, IDEMPOTENCY_KEY_INVALID (malformed Idempotency-Key header).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Referenced category or account not found (or not owned by the user)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The transaction originally created with this Idempotency-Key was deleted; retry with a new key (code IDEMPOTENCY_ORIGINAL_DELETED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Idempotency-Key was already used with a different payload (code IDEMPOTENCY_PAYLOAD_MISMATCH)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/",
  validate(createTransactionSchema),
  TransactionController.createTransaction,
);

/**
 * @openapi
 * /transactions/quick:
 *   post:
 *     tags: [Transactions]
 *     summary: Quick-add a transaction (amount only; other fields defaulted)
 *     description: |
 *       Low-friction capture: only `amount` is required. Defaults: `type` = EXPENSE,
 *       `date` = now, and the missing side account = the user's default account.
 *       The created transaction is flagged `pendingDetails: true` and `source: QUICK`
 *       so the client can list it for later detailing. ADJUSTMENT is not allowed here.
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema:
 *           type: string
 *           pattern: "^[A-Za-z0-9_-]{1,200}$"
 *         description: |
 *           Optional retry-safety key (1-200 chars of [A-Za-z0-9_-]). Retrying with the
 *           same key and payload returns the already-created transaction instead of a
 *           duplicate. Keys expire after 24 hours.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/QuickAddTransactionInput'
 *     responses:
 *       201:
 *         description: Transaction created (pendingDetails=true, source=QUICK)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Validation error. Codes include NO_DEFAULT_ACCOUNT (no account id given and no default account set), FUTURE_DATE, CURRENCY_MISMATCH, CATEGORY_ARCHIVED, CATEGORY_TYPE_MISMATCH, IDEMPOTENCY_KEY_INVALID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Referenced category or account not found (or not owned by the user)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The transaction originally created with this Idempotency-Key was deleted; retry with a new key (code IDEMPOTENCY_ORIGINAL_DELETED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Idempotency-Key was already used with a different payload (code IDEMPOTENCY_PAYLOAD_MISMATCH)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/quick",
  validate(quickAddTransactionSchema),
  TransactionController.quickAddTransaction,
);

/**
 * @openapi
 * /transactions/tags:
 *   get:
 *     tags: [Transactions]
 *     summary: Distinct tags used by the user (autocomplete source)
 *     responses:
 *       200:
 *         description: Sorted list of the user's distinct tags (stored trimmed and lowercased)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TagList'
 *       401:
 *         description: Unauthorized
 */
router.get("/tags", TransactionController.getTags);

/**
 * @openapi
 * /transactions/{id}:
 *   get:
 *     tags: [Transactions]
 *     summary: Get a transaction by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transaction ID
 *     responses:
 *       200:
 *         description: Transaction found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Invalid ID format
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transaction not found
 */
router.get(
  "/:id",
  validate(idParamSchema),
  TransactionController.getTransactionById,
);

/**
 * @openapi
 * /transactions/{id}:
 *   put:
 *     tags: [Transactions]
 *     summary: Update a transaction
 *     description: |
 *       Partial update; the merged result must still be a valid transaction of its type.
 *       When the money movement changes (type, amount, or accounts), the original balance
 *       changes are reversed and the new ones applied atomically.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transaction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTransactionInput'
 *     responses:
 *       200:
 *         description: Transaction updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Validation error. Codes include FUTURE_DATE, CURRENCY_MISMATCH, CATEGORY_ARCHIVED (assigning an archived category; keeping the one it already had is allowed), CATEGORY_TYPE_MISMATCH.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transaction, category, or account not found (or not owned by the user)
 */
router.put(
  "/:id",
  validate(updateTransactionSchema),
  TransactionController.updateTransaction,
);

/**
 * @openapi
 * /transactions/{id}:
 *   delete:
 *     tags: [Transactions]
 *     summary: Delete a transaction
 *     description: Deletes the transaction (soft delete) and reverses any balance changes on associated accounts.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transaction ID
 *     responses:
 *       200:
 *         description: Transaction deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Invalid ID format
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transaction not found
 */
router.delete(
  "/:id",
  validate(idParamSchema),
  TransactionController.deleteTransaction,
);

export default router;
