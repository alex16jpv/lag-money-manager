import { Router } from "express";
import { AccountController } from "../controllers/AccountController";
import { validate } from "../validation/validate";
import {
  createAccountSchema,
  updateAccountSchema,
  idParamSchema,
} from "../validation/schemas";

const router = Router();

/**
 * @openapi
 * /accounts:
 *   get:
 *     tags: [Accounts]
 *     summary: Get all accounts
 *     responses:
 *       200:
 *         description: List of accounts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Account'
 *       401:
 *         description: Unauthorized
 */
router.get("/", AccountController.getAllAccounts);

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

export default router;
