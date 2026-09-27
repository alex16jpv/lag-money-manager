import { Router } from "express";

import { ENVIRONMENT } from "../../shared/constants";
import { AuthController } from "../controllers/AuthController";
import { createCaptchaVerifier } from "../factories/captchaFactory";
import { authMiddleware } from "../middlewares/authMiddleware";
import { authRateLimit } from "../middlewares/authRateLimitMiddleware";
import { requireCaptcha } from "../middlewares/captchaMiddleware";
import { clientIp } from "../middlewares/clientIp";
import { attemptedEmail } from "../middlewares/loginAttempt";
import {
  forgotPasswordSchema,
  idParamSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_WINDOW_MS = 60 * 60 * 1000;

// A carrier NAT puts thousands of unrelated users behind one address, so the per-IP budget cannot be the per-account one.
const loginLimiter = authRateLimit({
  keyPrefix: "login",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});

// Only failed attempts burn these budgets (refundOnSuccess), so real logins cost nothing.
const deviceLimiter = authRateLimit({
  keyPrefix: "login-device",
  max: ENVIRONMENT.AUTH_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
  refundOnSuccess: true,
  keyFrom: (req) => req.recognizedDevice ?? null,
});
const emailIpLimiter = authRateLimit({
  keyPrefix: "login-email-ip",
  max: ENVIRONMENT.AUTH_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
  refundOnSuccess: true,
  keyFrom: (req) => {
    const email = attemptedEmail(req);
    if (!email || req.recognizedDevice) return null;
    return `${email}:${clientIp(req) || "unknown"}`;
  },
});
const emailLimiter = authRateLimit({
  keyPrefix: "login-email",
  max: ENVIRONMENT.AUTH_EMAIL_RATE_LIMIT_MAX,
  windowMs: EMAIL_WINDOW_MS,
  refundOnSuccess: true,
  keyFrom: (req) => (req.recognizedDevice ? null : attemptedEmail(req)),
});
const accountLimiters = [
  AuthController.recognizeDevice,
  deviceLimiter,
  emailIpLimiter,
  emailLimiter,
];

const registerLimiter = authRateLimit({
  keyPrefix: "register",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
// A volume brake ahead of the captcha, which costs a call to Cloudflare; the email's own brakes come after.
const forgotLimiter = authRateLimit({
  keyPrefix: "forgot",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
const resetLimiter = authRateLimit({
  keyPrefix: "reset",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
const captcha = createCaptchaVerifier();

// Refresh is legitimate high-frequency traffic (~15 min per device), so its threshold is higher.
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
 *       lowercase). Registering with the email and the password of a
 *       soft-deleted account reactivates that account with its full financial
 *       history (the response's `user.reactivated` is `true` and the original
 *       currency is kept — the `currency` sent in that register is ignored);
 *       with any other password it answers 409 EMAIL_TAKEN, like a live
 *       account. On a 500 the
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
 *           Email is already registered (code EMAIL_TAKEN): a live account,
 *           a soft-deleted one registered with a different password, or a
 *           concurrent register that reactivated it first
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: >
 *           Too many attempts from this client IP, or too many failed ones
 *           for this email — from this device if `deviceToken` recognizes
 *           it, otherwise from this IP or in total — counted with the
 *           failed logins (code RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/register",
  registerLimiter,
  ...accountLimiters,
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
 *       Returns a short-lived access token (~15 min), a refresh token and a
 *       `deviceToken`. Rate-limited per IP, and failed attempts per account:
 *       send the `deviceToken` of this device's last login or register and
 *       they count against this device alone, so nobody else's failures can
 *       lock it out; without one they count per email and IP and per email in
 *       total. Successful logins are refunded.
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
 *         description: >
 *           Too many attempts from this client IP, or too many failed ones
 *           for this email — from this device if `deviceToken` recognizes
 *           it, otherwise from this IP or in total (code RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/login",
  loginLimiter,
  ...accountLimiters,
  validate(loginSchema),
  AuthController.login,
);

/**
 * @openapi
 * /auth/password/forgot:
 *   post:
 *     tags: [Auth]
 *     summary: Email a code and a link to choose a new password
 *     description: >
 *       Always the same answer, in at least the same time, whether the
 *       address has a live account, a deleted one or none, and whether the
 *       email could be sent: nothing here may tell them apart. Only a live
 *       account is emailed, in its own language: a 6-digit code and a link
 *       (`/{locale}/reset#token=…`), both good for 30 minutes and for one
 *       reset. A new code replaces the previous one only once its email was
 *       accepted for delivery. `captcha` is a Cloudflare Turnstile token
 *       issued for the action `forgot-password`, asked for when the button is
 *       pressed: it works once. `deviceToken`, from this device's last login
 *       or register, lets the limits count this device instead of its IP.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordInput'
 *     responses:
 *       202:
 *         description: >
 *           Taken. If the address has an account, a code is on its way.
 *           `resendAfterSeconds` is the same for every address: the countdown
 *           before Resend.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ForgotPasswordAccepted'
 *       400:
 *         description: >
 *           Validation error (code VALIDATION), or Cloudflare refused the
 *           captcha token: spent, expired, forged, or issued for another site
 *           or action (code CAPTCHA_INVALID). Ask for a new token and try
 *           again
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: >
 *           Too many requests (code RATE_LIMITED; `Retry-After` in seconds):
 *           from this IP, from this device or IP in the hour, or for this
 *           address — one a minute and five a day. Counted the same for every
 *           address, account or not
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: >
 *           The captcha could not be checked, so nothing was sent (code
 *           CAPTCHA_UNAVAILABLE). Try again
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/password/forgot",
  forgotLimiter,
  AuthController.recognizeDevice,
  validate(forgotPasswordSchema),
  requireCaptcha("forgot-password", captcha),
  AuthController.forgotPassword,
);

/**
 * @openapi
 * /auth/password/reset:
 *   post:
 *     tags: [Auth]
 *     summary: Choose a new password with the emailed code or link
 *     description: >
 *       Either the address and the 6-digit code, or the link's token alone
 *       (it names the account). Sets the password, signs out every other
 *       device (every refresh and device token issued before stops working),
 *       confirms the account's email, and answers a session like a login.
 *       Using a code or the link spends every code of that request. A code
 *       takes five tries. When the account had never confirmed its email and
 *       holds accounts or transactions, the answer's `user.keepOrStartFresh`
 *       is set: ask "Keep what's in this account?" before opening anything
 *       (`POST /users/{id}/keep-or-start-fresh`).
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordInput'
 *     responses:
 *       200:
 *         description: Password changed and signed in
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokens'
 *       400:
 *         description: >
 *           Validation error (code VALIDATION); a code that does not work —
 *           mistyped, expired, replaced by a newer one, used up by five
 *           tries, or for an address with no account, all one answer (code
 *           RESET_CODE_INVALID); or a link that no longer works — used,
 *           expired or replaced (code LINK_INVALID)
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
  "/password/reset",
  resetLimiter,
  validate(resetPasswordSchema),
  AuthController.resetPassword,
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
 *       required). One exception, for the answer that never arrives: while the
 *       successor of the presented token has not been used itself, the same
 *       pair is answered again — at any age, up to ten times — so a client that
 *       lost the response may simply ask again with the token it still has, and
 *       should not end its session on its own. The eleventh is refused with 401
 *       REFRESH_REVOKED and the session family survives, so that answer means
 *       "this token is over", not "this device was logged out". Rotation never
 *       extends the session past its original absolute expiry.
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
 *           revoked — reuse of a rotated token whose successor is already
 *           spent, logout, password/email change, or logout-all (code
 *           REFRESH_REVOKED)
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
