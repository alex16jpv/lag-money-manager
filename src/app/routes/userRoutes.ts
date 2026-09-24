import { Router } from "express";

import { UserController } from "../controllers/UserController";
import { authRateLimit } from "../middlewares/authRateLimitMiddleware";
import {
  deleteUserSchema,
  idParamSchema,
  updateUserSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";
import { ENVIRONMENT } from "../../shared/constants";

const router = Router();

// A stolen access token must get the login's budget of password guesses, not the API's.
const currentPasswordLimiter = authRateLimit({
  keyPrefix: "current-password",
  max: ENVIRONMENT.AUTH_RATE_LIMIT_MAX,
  windowMs: 15 * 60 * 1000,
  refundOnSuccess: true,
  keyFrom: (req) =>
    (req.body as { currentPassword?: unknown } | undefined)?.currentPassword !==
      undefined && req.user
      ? req.user.userId
      : null,
});

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid ID format (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing, invalid or expired access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found (or not the authenticated user's id)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id", validate(idParamSchema), UserController.getUserById);

/**
 * @openapi
 * /users/{id}:
 *   put:
 *     tags: [Users]
 *     summary: Update a user
 *     description: >
 *       Changing `email` or `password` requires `currentPassword`
 *       (re-authentication) and revokes every refresh token — other devices
 *       must log in again. `currency` can only change while the user has no
 *       accounts (mono-currency mode). Changing the email to one belonging to
 *       another account (soft-deleted included) conflicts — reactivation only
 *       applies on register.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserInput'
 *     responses:
 *       200:
 *         description: User updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: >
 *           Validation error, e.g. missing currentPassword when changing
 *           email/password (code VALIDATION), or currency change while
 *           accounts exist (code CURRENCY_LOCKED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: >
 *           Missing, invalid or expired access token, or wrong
 *           currentPassword (code CURRENT_PASSWORD_INVALID)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found (or not the authenticated user's id)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Email already used by another account (code DUPLICATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: >
 *           Too many wrong currentPassword guesses for this user (code
 *           RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put(
  "/:id",
  currentPasswordLimiter,
  validate(updateUserSchema),
  UserController.updateUser,
);

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Delete a user
 *     description: >
 *       Requires `currentPassword`: a hijacked 15-minute access token must not
 *       be able to delete the account. Soft delete: the account and its
 *       financial history are kept, and registering again with the same email
 *       and the password it had reactivates it.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeleteUserInput'
 *     responses:
 *       200:
 *         description: User deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Invalid ID format or missing currentPassword (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: >
 *           Missing, invalid or expired access token, or wrong
 *           currentPassword (code CURRENT_PASSWORD_INVALID)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found (or not the authenticated user's id)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: >
 *           Too many wrong currentPassword guesses for this user (code
 *           RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete(
  "/:id",
  currentPasswordLimiter,
  validate(deleteUserSchema),
  UserController.deleteUser,
);

export default router;
