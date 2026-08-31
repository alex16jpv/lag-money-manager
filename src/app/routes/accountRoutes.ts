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
 *     description: Archived accounts are hidden unless includeArchived=true.
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
 *         description: Comma-separated list of account UUIDs to filter by ID (1-100)
 *       - in: query
 *         name: includeArchived
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Include archived accounts in the listing
 *     responses:
 *       200:
 *         description: Paginated list of accounts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AccountList'
 *       400:
 *         description: Invalid query parameters (code VALIDATION)
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
  validate(paginationQuerySchema),
  AccountController.getAllAccounts,
);

/**
 * @openapi
 * /accounts:
 *   post:
 *     tags: [Accounts]
 *     summary: Create a new account
 *     description: >
 *       The first account is marked default automatically. Currency is
 *       stamped from the user (mono-currency mode). Active account names are
 *       unique per user, case-insensitively ("Efectivo" = "efectivo"; accents
 *       still distinct) and trimmed; archiving an account frees its name.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAccountInput'
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
 *       400:
 *         description: Validation error (code VALIDATION) or account limit reached (code ACCOUNT_LIMIT_REACHED)
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
 *       409:
 *         description: An active account with this name already exists (code DUPLICATE, case-insensitive)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *     description: >
 *       Also resolves archived accounts (archivedAt tells them apart);
 *       only the listing hides them by default.
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
 *         description: Account found (may be archived)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
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
 *         description: Account not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *             $ref: '#/components/schemas/UpdateAccountInput'
 *     responses:
 *       200:
 *         description: Account updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
 *       400:
 *         description: Validation error (code VALIDATION) or account is archived (code RESOURCE_ARCHIVED, restore it first)
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
 *         description: Account not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Another active account already uses this name (code DUPLICATE, case-insensitive)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *     summary: Archive an account (soft delete)
 *     description: >
 *       Idempotent - archiving an already-archived account is a no-op
 *       success. Allowed even with linked transactions.
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
 *         description: Account archived
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Invalid ID format (code VALIDATION) or account is the default (code DEFAULT_ACCOUNT_ARCHIVE_BLOCKED, set another default first)
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
 *         description: Account not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete("/:id", validate(idParamSchema), AccountController.deleteAccount);

/**
 * @openapi
 * /accounts/{id}/restore:
 *   post:
 *     tags: [Accounts]
 *     summary: Restore an archived account
 *     description: >
 *       Idempotent - restoring an already-active account returns it
 *       unchanged.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Account ID
 *     responses:
 *       200:
 *         description: Account restored (or already active)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
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
 *         description: Account not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An active account took this name while it was archived (code DUPLICATE) — rename that one first
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/restore",
  validate(idParamSchema),
  AccountController.restoreAccount,
);

/**
 * @openapi
 * /accounts/{id}/default:
 *   post:
 *     tags: [Accounts]
 *     summary: Mark an account as the user's default
 *     description: The previous default account is unmarked automatically.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Account ID
 *     responses:
 *       200:
 *         description: Default account set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Account'
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
 *         description: Account not found (uniform for missing, not owned, and archived)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/default",
  validate(idParamSchema),
  AccountController.setDefaultAccount,
);

export default router;
