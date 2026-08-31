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
 *         description: Comma-separated list of UUIDs to filter by ID
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter transactions by account ID (matches fromAccountId or toAccountId)
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
 *               $ref: '#/components/schemas/PaginatedTransactions'
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
 *     summary: Create a new transaction (income, expense, or transfer)
 *     description: |
 *       Creates a transaction and updates account balances accordingly.
 *       - **INCOME**: Adds amount to `toAccountId` (required).
 *       - **EXPENSE**: Subtracts amount from `fromAccountId` (required).
 *       - **TRANSFER**: Subtracts from `fromAccountId` and adds to `toAccountId` (both required).
 *       - **ADJUSTMENT**: Balance reconciliation; exactly one of `fromAccountId` (decrease) or `toAccountId` (increase), no `categoryId`. Excluded from spending stats and budgets.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTransaction'
 *     responses:
 *       201:
 *         description: Transaction created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Unauthorized
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: number }
 *     responses:
 *       201: { description: Transaction created (pendingDetails=true) }
 *       400: { description: Validation error or no default account }
 */
router.post(
  "/quick",
  validate(quickAddTransactionSchema),
  TransactionController.quickAddTransaction,
);

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
 *     description: Reverses the balance changes from the original transaction and applies new ones.
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
 *             $ref: '#/components/schemas/UpdateTransaction'
 *     responses:
 *       200:
 *         description: Transaction updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transaction not found
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
 *     description: Deletes the transaction and reverses any balance changes on associated accounts.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transaction ID
 *     responses:
 *       204:
 *         description: Transaction deleted
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
