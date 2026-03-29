import { Router } from "express";
import { TransactionController } from "../controllers/TransactionController";
import { validate } from "../validation/validate";
import {
  createTransactionSchema,
  updateTransactionSchema,
  idParamSchema,
} from "../validation/schemas";

const router = Router();

/**
 * @openapi
 * /transactions:
 *   get:
 *     tags: [Transactions]
 *     summary: Get all transactions
 *     responses:
 *       200:
 *         description: List of transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transaction'
 *       401:
 *         description: Unauthorized
 */
router.get("/", TransactionController.getAllTransactions);

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
 * /transactions/{id}:
 *   get:
 *     tags: [Transactions]
 *     summary: Get a transaction by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *           type: integer
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
 *           type: integer
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
