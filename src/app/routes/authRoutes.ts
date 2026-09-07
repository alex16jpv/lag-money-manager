import { Router } from "express";

import { ENVIRONMENT } from "../../shared/constants";
import { AuthController } from "../controllers/AuthController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { authRateLimit } from "../middlewares/authRateLimitMiddleware";
import {
  idParamSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const loginLimiter = authRateLimit({
  keyPrefix: "login",
  max: ENVIRONMENT.AUTH_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
// Second dimension for login: a distributed attack on ONE account rotates
// IPs, so the target email needs its own counter.
const loginEmailLimiter = authRateLimit({
  keyPrefix: "login-email",
  max: ENVIRONMENT.AUTH_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
  // Only failed logins burn the per-account budget (no lockout-DoS by a
  // third party spamming the victim's email, no cost for real logins).
  refundOnSuccess: true,
  // Runs before Zod: normalize the same way the schema will.
  keyFrom: (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === "string" && email
      ? email.trim().toLowerCase()
      : null;
  },
});
const registerLimiter = authRateLimit({
  keyPrefix: "register",
  max: ENVIRONMENT.AUTH_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
// Refresh is legitimate high-frequency traffic (every ~15 min per device):
// it gets its own, higher threshold.
const refreshLimiter = authRateLimit({
  keyPrefix: "refresh",
  max: ENVIRONMENT.REFRESH_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new user
 *     description: >
 *       Register acts as login: the response already carries the token pair,
 *       no follow-up login call is needed. Emails are normalized (trim +
 *       lowercase). Registering with the email of a soft-deleted account
 *       reactivates that account with its full financial history (the
 *       response's `user.reactivated` is `true` and the original currency is
 *       kept — the `currency` sent in that register is ignored). On a 500 the
 *       user may still have been created: try login before retrying register.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterInput'
 *     responses:
 *       201:
 *         description: User registered and logged in
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokens'
 *       400:
 *         description: Validation error (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: >
 *           Email is already registered (code DUPLICATE from the unique
 *           index, or EMAIL_TAKEN when a concurrent register reactivated the
 *           same soft-deleted account)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many attempts from this IP (code RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/register",
  registerLimiter,
  validate(registerSchema),
  AuthController.register,
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login and obtain a JWT token
 *     description: >
 *       Returns a short-lived access token (~15 min) plus a refresh token.
 *       Rate-limited per IP and per email; the per-email counter only burns
 *       on failed attempts (successful logins are refunded).
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginInput'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokens'
 *       400:
 *         description: Validation error (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Invalid email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many attempts (code RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/login",
  loginLimiter,
  loginEmailLimiter,
  validate(loginSchema),
  AuthController.login,
);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access + refresh token pair
 *     description: >
 *       True rotation: the presented refresh token is invalidated and a new
 *       pair is issued (the response carries no `user`). Always store the new
 *       token — replaying an already-rotated one is treated as theft and
 *       revokes the whole device session family (401 REFRESH_REVOKED, re-login
 *       required). Rotation never extends the session past its original
 *       absolute expiry.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshInput'
 *     responses:
 *       200:
 *         description: New token pair issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokens'
 *       400:
 *         description: Validation error (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: >
 *           Invalid or expired refresh token (code REFRESH_INVALID), or token
 *           revoked — reuse of a rotated token, password/email change, or
 *           logout-all (code REFRESH_REVOKED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many attempts (code RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/refresh",
  refreshLimiter,
  validate(refreshSchema),
  AuthController.refresh,
);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke the refresh token's session family (per-device logout)
 *     description: >
 *       Authenticated by the refresh token in the body (no access token
 *       needed). Idempotent for an already-revoked session of a valid token.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshInput'
 *     responses:
 *       200:
 *         description: Session revoked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Validation error (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Invalid or expired refresh token (code REFRESH_INVALID)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many attempts (code RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/logout",
  refreshLimiter,
  validate(refreshSchema),
  AuthController.logout,
);

/**
 * @openapi
 * /auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke every session of the authenticated user
 *     description: >
 *       Bumps the user's token version, so every outstanding refresh token
 *       stops working (subsequent refreshes fail with 401 REFRESH_REVOKED).
 *     responses:
 *       200:
 *         description: All sessions revoked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       401:
 *         description: Missing, invalid or expired access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/logout-all", authMiddleware, AuthController.logoutAll);

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     tags: [Auth]
 *     summary: List the user's active device sessions
 *     description: One row per device login. `current` is true for the row the requesting access token belongs to; tokens issued before this claim existed mark none until renewed.
 *     responses:
 *       200:
 *         description: Active sessions (one per device login)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionList'
 *       401:
 *         description: Missing, invalid or expired access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/sessions", authMiddleware, AuthController.listSessions);

/**
 * @openapi
 * /auth/sessions/{id}:
 *   delete:
 *     tags: [Auth]
 *     summary: Revoke one device session by its id
 *     description: >
 *       Idempotent: revoking an own, already-revoked session is a no-op
 *       success.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session id (from GET /auth/sessions)
 *     responses:
 *       200:
 *         description: Session revoked (idempotent)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       400:
 *         description: Invalid id format (code VALIDATION)
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
 *         description: Not the user's session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete(
  "/sessions/:id",
  authMiddleware,
  validate(idParamSchema),
  AuthController.revokeSession,
);

export default router;
