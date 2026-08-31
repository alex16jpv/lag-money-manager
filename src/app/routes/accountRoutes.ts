import { Router } from "express";

import { AccountController } from "../controllers/AccountController";
import {
  createAccountSchema,
  idParamSchema,
  paginationQuerySchema,
  updateAccountSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /accounts:
 *   get:
 *     tags: [Accounts]
 *     summary: Get all accounts
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
 *     responses:
 *       200:
 *         description: Paginated list of accounts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedAccounts'
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/",
  validate(paginationQuerySchema),
  AccountController.getAllAccounts,
);

/**
 * @openapi
 * /accounts:
 *   post:
 *     tags: [Accounts]
 *     summary: Create a new account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAccount'
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
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
  validate(createAccountSchema),
  AccountController.createAccount,
);

/**
 * @openapi
 * /accounts/{id}:
 *   get:
 *     tags: [Accounts]
 *     summary: Get an account by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Account ID
 *     responses:
 *       200:
 *         description: Account found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
 *       400:
 *         description: Invalid ID format
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Account not found
 */
router.get("/:id", validate(idParamSchema), AccountController.getAccountById);

/**
 * @openapi
 * /accounts/{id}:
 *   put:
 *     tags: [Accounts]
 *     summary: Update an account
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Account ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAccount'
 *     responses:
 *       200:
 *         description: Account updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Account not found
 */
router.put(
  "/:id",
  validate(updateAccountSchema),
  AccountController.updateAccount,
);

/**
 * @openapi
 * /accounts/{id}:
 *   delete:
 *     tags: [Accounts]
 *     summary: Delete an account
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Account ID
 *     responses:
 *       204:
 *         description: Account deleted
 *       400:
 *         description: Invalid ID format
 *       401:
 *         description: Unauthorized
 */
router.delete("/:id", validate(idParamSchema), AccountController.deleteAccount);

/**
 * @openapi
 * /accounts/{id}/restore:
 *   post:
 *     tags: [Accounts]
 *     summary: Restore an archived account
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Account restored }
 *       404: { description: Archived account not found }
 */
router.post(
  "/:id/restore",
  validate(idParamSchema),
  AccountController.restoreAccount,
);

export default router;
