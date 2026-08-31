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
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
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
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New token pair issued
 *       401:
 *         description: Invalid, expired or revoked refresh token
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
 *     responses:
 *       200: { description: Session revoked }
 *       401: { description: Invalid refresh token }
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
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: All sessions revoked }
 */
router.post("/logout-all", authMiddleware, AuthController.logoutAll);

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     tags: [Auth]
 *     summary: List the user's active device sessions
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Active sessions (one per device login) }
 */
router.get("/sessions", authMiddleware, AuthController.listSessions);

/**
 * @openapi
 * /auth/sessions/{id}:
 *   delete:
 *     tags: [Auth]
 *     summary: Revoke one device session by its id
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Session revoked (idempotent) }
 *       404: { description: Not the user's session }
 */
router.delete(
  "/sessions/:id",
  authMiddleware,
  validate(idParamSchema),
  AuthController.revokeSession,
);

export default router;
