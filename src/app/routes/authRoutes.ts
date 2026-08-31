import { Router } from "express";

import { ENVIRONMENT } from "../../shared/constants";
import { AuthController } from "../controllers/AuthController";
import { authRateLimit } from "../middlewares/authRateLimitMiddleware";
import { loginSchema,registerSchema } from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const loginLimiter = authRateLimit({
  keyPrefix: "login",
  max: ENVIRONMENT.AUTH_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
const registerLimiter = authRateLimit({
  keyPrefix: "register",
  max: ENVIRONMENT.AUTH_RATE_LIMIT_MAX,
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
  validate(loginSchema),
  AuthController.login,
);

export default router;
