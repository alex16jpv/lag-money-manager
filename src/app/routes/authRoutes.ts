import { NextFunction, Request, Response, Router } from "express";

import { ENVIRONMENT } from "../../shared/constants";
import { AuthController } from "../controllers/AuthController";
import { createCaptchaVerifier } from "../factories/captchaFactory";
import { authMiddleware } from "../middlewares/authMiddleware";
import { authRateLimit } from "../middlewares/authRateLimitMiddleware";
import { requireCaptcha } from "../middlewares/captchaMiddleware";
import { clientIp } from "../middlewares/clientIp";
import { attemptedEmail } from "../middlewares/loginAttempt";
import {
  confirmEmailChangeSchema,
  forgotPasswordSchema,
  idParamSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  restoreAccountSchema,
  restoreFromLinkSchema,
  signUpConfirmSchema,
  signUpResendSchema,
  signUpSchema,
  undoEmailChangeSchema,
  verifyEmailSchema,
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
const verifyLimiter = authRateLimit({
  keyPrefix: "verify-email",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
const resendLimiter = authRateLimit({
  keyPrefix: "resend-verification",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
const confirmChangeLimiter = authRateLimit({
  keyPrefix: "confirm-email-change",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
const signUpConfirmLimiter = authRateLimit({
  keyPrefix: "sign-up-confirm",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
const restoreLinkLimiter = authRateLimit({
  keyPrefix: "restore-link",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
const undoLimiter = authRateLimit({
  keyPrefix: "undo-email-change",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});
const captcha = createCaptchaVerifier();

// Runs after validate(): only a body with a code needs the session.
const sessionForCode = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if ("code" in (req.body as object)) {
    authMiddleware(req, res, next);
    return;
  }
  next();
};

// Refresh is legitimate high-frequency traffic (~15 min per device), so its threshold is higher.
const refreshLimiter = authRateLimit({
  keyPrefix: "refresh",
  max: ENVIRONMENT.REFRESH_RATE_LIMIT_MAX,
  windowMs: AUTH_WINDOW_MS,
});

/**
 * @openapi
 * /auth/sign-up:
 *   post:
 *     tags: [Auth]
 *     summary: Start creating an account; its emailed code creates it
 *     description: >
 *       Nothing is created yet (the owner's decision 16): what was typed waits
 *       24 hours, and a new sign-up for the address replaces it. The answer,
 *       its limits and its time are the same for every address, so it never
 *       tells who has an account: an address with no account is sent
 *       `sign-up` (a 6-digit code and a link, 24 hours); one with an account
 *       — live, deleted and still kept, or kept by an undo link — is sent
 *       `account-exists` instead, and its sign-up can never be confirmed. A
 *       send that fails is never shown. Keep `signUpToken` for this browser
 *       alone: `POST /auth/sign-up/confirm` takes it with the code. `captcha`
 *       is a Cloudflare Turnstile token for the action `register`;
 *       `deviceToken` lets the limits count this device instead of its IP.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignUpInput'
 *     responses:
 *       202:
 *         description: Taken, the same for every address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SignUpStarted'
 *       400:
 *         description: >
 *           Validation error, a missing captcha among them (code
 *           VALIDATION), or Cloudflare refused the captcha token (code
 *           CAPTCHA_INVALID). Ask for a new token and try again
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: >
 *           Too many requests (code RATE_LIMITED; `Retry-After` in seconds):
 *           from this IP, from this device or IP in the hour, or for this
 *           address — one a minute and five a day. Counted the same for every
 *           address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: >
 *           The captcha could not be checked (code CAPTCHA_UNAVAILABLE):
 *           nothing was sent. Try again
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/sign-up",
  registerLimiter,
  AuthController.recognizeDevice,
  validate(signUpSchema),
  requireCaptcha("register", captcha),
  AuthController.signUp,
);

/**
 * @openapi
 * /auth/sign-up/resend:
 *   post:
 *     tags: [Auth]
 *     summary: Email the sign-up again
 *     description: >
 *       Resend code of the sign-up's code step: `sign-up` with a new code, or
 *       `account-exists` if the address has an account by now, under the same
 *       limits and in the same time either way. A new code replaces the old
 *       one only once its email was accepted. A send that fails is never
 *       shown. `captcha` is a Cloudflare Turnstile token for the action
 *       `register`.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignUpResendInput'
 *     responses:
 *       202:
 *         description: Taken
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerificationCodeSent'
 *       400:
 *         description: Validation error (code VALIDATION) or a refused captcha (code CAPTCHA_INVALID)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: >
 *           The sign-up is over: its 24 hours passed or a newer one for the
 *           address replaced it (code SIGN_UP_EXPIRED). Start again from
 *           Create account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many requests (code RATE_LIMITED; `Retry-After` in seconds)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: The captcha could not be checked (code CAPTCHA_UNAVAILABLE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/sign-up/resend",
  registerLimiter,
  validate(signUpResendSchema),
  requireCaptcha("register", captcha),
  AuthController.resendSignUp,
);

/**
 * @openapi
 * /auth/sign-up/confirm:
 *   post:
 *     tags: [Auth]
 *     summary: Create the account with the emailed code, and sign in here
 *     description: >
 *       Only with the `signUpToken` of the browser where the password was
 *       typed: the code alone never signs anyone in. Creates the account,
 *       its email confirmed, and answers a session with its device token, so
 *       no `new-sign-in` is sent. If the email's link created the account
 *       first, the same code signs in once. A code takes five tries and every
 *       bad one gets the same answer.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignUpConfirmInput'
 *     responses:
 *       201:
 *         description: The account exists and this device is signed in
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokens'
 *       400:
 *         description: >
 *           Validation error (code VALIDATION), or a code that does not work —
 *           mistyped, expired, replaced, used up by five tries, already used
 *           to sign in, or for a sign-up that is over: all one answer (code
 *           SIGN_UP_CODE_INVALID)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: >
 *           The address became another account's meanwhile (code
 *           EMAIL_TAKEN): only whoever holds the code sees it
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
  "/sign-up/confirm",
  signUpConfirmLimiter,
  validate(signUpConfirmSchema),
  AuthController.confirmSignUp,
);

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     deprecated: true
 *     summary: Register a new user, before its email is confirmed
 *     description: >
 *       Kept only until the app confirms the email before the account
 *       exists (`POST /auth/sign-up`); then it goes. Register acts as login:
 *       the response already carries the token pair. Emails are normalized
 *       (trim + lowercase). An address with any account, live or deleted and
 *       still kept, answers 409 EMAIL_TAKEN: a deleted account comes back by
 *       signing in. `captcha` is a Cloudflare Turnstile token for the action
 *       `register`. The account is sent `verify-email`; a send that fails does
 *       not fail the register.
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
 *         description: >
 *           Validation error, a missing captcha among them (code
 *           VALIDATION), or Cloudflare refused the captcha token (code
 *           CAPTCHA_INVALID). Ask for a new token and try again
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Email is already registered (code EMAIL_TAKEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: >
 *           Too many attempts from this client IP, or too many failed ones
 *           for this email, counted with the failed logins (code
 *           RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: >
 *           The captcha could not be checked (code CAPTCHA_UNAVAILABLE):
 *           nothing was created. Try again
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
  requireCaptcha("register", captcha),
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
 *       total. Successful logins are refunded. A login whose `deviceToken` is
 *       not one this account's email gave since its last undo, restore link
 *       or logout-all emails `new-sign-in` to that email, when it is confirmed.
 *       The right password of an account deleted in its last 30 days answers
 *       409 ACCOUNT_DELETED with its two days and opens nothing: "Restore your
 *       account?" then calls `POST /auth/login/restore`. A wrong password
 *       reads the same for every address, deleted or not.
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
 *       409:
 *         description: >
 *           The right password of a deleted account that is still kept (code
 *           ACCOUNT_DELETED): `deletedAccount` says when it was deleted and
 *           its last day
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AccountDeletedResponse'
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
 * /auth/login/restore:
 *   post:
 *     tags: [Auth]
 *     summary: Restore a deleted account and sign in
 *     description: >
 *       "Restore account" of "Restore your account?", with the same email and
 *       password as the sign-in that answered ACCOUNT_DELETED, under the same
 *       limits. Brings the account back with everything it had, except the
 *       shared groups it left and the invitations that ended, signs in like a
 *       login and emails `account-restored`. An account that is no longer
 *       deleted just signs in.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RestoreAccountInput'
 *     responses:
 *       200:
 *         description: Restored and signed in
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
 *           Invalid email or password, or the account is no longer kept
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many attempts, counted with the logins (code RATE_LIMITED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/login/restore",
  loginLimiter,
  ...accountLimiters,
  validate(restoreAccountSchema),
  AuthController.restoreAccount,
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
 *       email could be sent: nothing here may tell them apart. A live account
 *       and one deleted in its last 30 days are emailed, in their own
 *       language: a 6-digit code and a link (`/{locale}/reset#token=…`), both
 *       good for 30 minutes and for one reset; the deleted one in its own
 *       words, since choosing a password restores it. A new code replaces the previous one only once its email was
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
 *       takes five tries. A deleted account still kept comes back
 *       (`restored`), and `account-restored` goes instead of
 *       `password-changed`. A change of email that was waiting is cancelled.
 *       Devices are not forgotten: signing in again on one sends no
 *       `new-sign-in`. The code of `password-reset-after-undo` is redeemed
 *       here as well.
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
 *               $ref: '#/components/schemas/PasswordResetDone'
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
 * /auth/email/verify:
 *   post:
 *     tags: [Auth]
 *     summary: Confirm an email with the emailed code or link
 *     description: >
 *       Either `{ code }`, with the session (`Authorization`) of the account
 *       the code went to, or `{ token }` from the email's link
 *       (`/{locale}/verify#token=…`) with no session: it names the account.
 *       The link of `sign-up` creates its account and signs nobody in
 *       (`result: account-ready`); the links of `verify-email` and of the
 *       deadline emails confirm an account from before email existed
 *       (`result: email-confirmed`) — a deadline link until its deadline.
 *       A code takes five tries and works for 24 hours; asking for another
 *       cancels it once the new email is accepted. Confirming is not spent:
 *       an account already confirmed answers 200 for its code and for its
 *       link, so tapping the link after typing the code reads "Email
 *       confirmed". A link for an address the account no longer has is
 *       LINK_INVALID, and so is one replaced by a newer code, even once the
 *       account is confirmed: only the newest email's link answers 200.
 *       Confirming ends the wait of the invitations addressed to it: they
 *       reach the change feed on the next pull.
 *     security:
 *       - {}
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyEmailInput'
 *     responses:
 *       200:
 *         description: The email is confirmed, or the sign-up's account exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailVerified'
 *       400:
 *         description: >
 *           Validation error (code VALIDATION); a code that is not the one
 *           sent (code EMAIL_CODE_INVALID); no code that still works — it
 *           expired, it was tried five times, or none was sent (code
 *           EMAIL_CODE_EXPIRED: send a new one); or a link that no longer
 *           works — expired, replaced, or for another address (code
 *           LINK_INVALID)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: A code with a missing, invalid or expired access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: A code for an account that no longer exists
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
  "/email/verify",
  verifyLimiter,
  validate(verifyEmailSchema),
  sessionForCode,
  AuthController.verifyEmail,
);

/**
 * @openapi
 * /auth/email/confirm-change:
 *   post:
 *     tags: [Auth]
 *     summary: Move the account to the new email with its code or link
 *     description: >
 *       Either `{ code }`, with the session (`Authorization`) of the account
 *       that asked for the change, or `{ token }` from the link of
 *       `email-change-confirm` (`/{locale}/confirm-email#token=…`) with no
 *       session: it names the account. In one write the account takes the
 *       new address, now confirmed, and `tokenVersion` goes up: every
 *       refresh token and device token issued before stops working, so every
 *       other device is signed out. The code answers a new session for this
 *       device (`accessToken`, `refreshToken`, `deviceToken`). The link
 *       answers one only when `refreshToken` is a live session of that same
 *       account — the browser that opened it was signed in to it —, and
 *       otherwise none: that browser stays as it was. A code takes five tries
 *       and works for 24 hours; a code or a link works once. Confirming ends
 *       the wait of the invitations addressed to the new email: they reach
 *       the change feed on the next pull.
 *     security:
 *       - {}
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ConfirmEmailChangeInput'
 *     responses:
 *       200:
 *         description: >
 *           The account has its new email. The tokens come with the code,
 *           and with the link only when it kept this browser's session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailChangeConfirmed'
 *       400:
 *         description: >
 *           Validation error (code VALIDATION); a code that is not the one
 *           sent (code EMAIL_CODE_INVALID); no code that still works — it
 *           was tried five times or replaced by a newer one (code
 *           EMAIL_CODE_EXPIRED: resend); or a link that no longer works —
 *           used, expired, replaced, cancelled, or the change was confirmed
 *           already (code LINK_INVALID)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: A code with a missing, invalid or expired access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: A code for an account that no longer exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: >
 *           A code when no new email waits: it was confirmed, cancelled or
 *           its 24 hours passed (code EMAIL_CHANGE_NOT_PENDING); or the new
 *           address became another account's meanwhile (code EMAIL_TAKEN):
 *           the change is dropped and the account keeps its email
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
  "/email/confirm-change",
  confirmChangeLimiter,
  validate(confirmEmailChangeSchema),
  sessionForCode,
  AuthController.confirmEmailChange,
);

/**
 * @openapi
 * /auth/email/resend:
 *   post:
 *     tags: [Auth]
 *     summary: Email a new code to confirm the account's email
 *     description: >
 *       Send code and Resend code of the sheet that confirms the email. Sends
 *       `verify-email` to the account's address, in its language: a 6-digit
 *       code and a link, both for 24 hours. The new code replaces the old one
 *       only once its email was accepted. Unlike Forgot your
 *       password?, a failed send is said: the address is the account's own.
 *       `captcha` is a Cloudflare Turnstile token for the action
 *       `verify-email`; `deviceToken`, from this device's last login or
 *       register, lets the limits count this device instead of its IP.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResendVerificationInput'
 *     responses:
 *       202:
 *         description: >
 *           The email was accepted for delivery. `resendAfterSeconds` is the
 *           countdown before Resend
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerificationCodeSent'
 *       400:
 *         description: >
 *           Validation error (code VALIDATION), or Cloudflare refused the
 *           captcha token (code CAPTCHA_INVALID)
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
 *         description: The account no longer exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The email is already confirmed (code EMAIL_ALREADY_VERIFIED)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: >
 *           The address does not accept our emails: it bounced or complained
 *           before, or the provider refused it (code EMAIL_SEND_FAILED). A
 *           code that was live before still works
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: >
 *           Too many requests (code RATE_LIMITED; `Retry-After` in seconds):
 *           from this IP, from this device or IP in the hour, for this
 *           account (five a day), or for this address — one a minute and
 *           five a day
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: >
 *           The email could not be sent, or may not have gone (code
 *           EMAIL_SEND_FAILED), or the captcha could not be checked (code
 *           CAPTCHA_UNAVAILABLE). A code that was live before still works
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/email/resend",
  authMiddleware,
  resendLimiter,
  validate(resendVerificationSchema),
  requireCaptcha("verify-email", captcha),
  AuthController.resendVerification,
);

/**
 * @openapi
 * /auth/email/restore:
 *   post:
 *     tags: [Auth]
 *     summary: Restore a deleted account from its email, and stop its password
 *     description: >
 *       "Restore account" of `account-deleted` (`/{locale}/restore#token=…`),
 *       for whoever did not delete it. It works for 7 days and once, even if
 *       the account was restored meanwhile. The account comes back, any change
 *       of email waiting is cancelled, every session and device token is
 *       revoked, every device is forgotten, and the password stops working:
 *       `password-reset-after-undo`, in its restore words, takes a code and a
 *       link to the account's address, which `/auth/password/reset` redeems.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RestoreFromLinkInput'
 *     responses:
 *       200:
 *         description: The account is back, with no usable password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RestoreLinkUsed'
 *       400:
 *         description: >
 *           Validation error (code VALIDATION), or a link that no longer
 *           works: used, past its 7 days, or the account is erased (code
 *           LINK_INVALID)
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
  "/email/restore",
  restoreLinkLimiter,
  validate(restoreFromLinkSchema),
  AuthController.restoreFromLink,
);

/**
 * @openapi
 * /auth/email/undo:
 *   post:
 *     tags: [Auth]
 *     summary: Undo an email change, from the old address
 *     description: >
 *       "Undo the change" of `email-change-requested` (`/{locale}/undo#token=…`),
 *       for whoever holds the address the account had. It works for 7 days
 *       and once, even after the change was confirmed, and brings back an
 *       account deleted since and still kept. The account goes back to that address (confirmed), any
 *       change still waiting is cancelled, every session and device token is
 *       revoked, and the password stops working: `password-reset-after-undo`
 *       takes a code and a link to that address, which `/auth/password/reset`
 *       redeems. The undo links issued after it stop working, with the
 *       addresses they kept; an earlier one still works, so the first link an
 *       owner received always wins. No `new-sign-in` and no
 *       `password-changed` are sent.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UndoEmailChangeInput'
 *     responses:
 *       200:
 *         description: The change is undone
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailChangeUndone'
 *       400:
 *         description: >
 *           Validation error (code VALIDATION), or a link that no longer
 *           works: used, past its 7 days, or stopped by the undo of an
 *           earlier link (code LINK_INVALID)
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
  "/email/undo",
  undoLimiter,
  validate(undoEmailChangeSchema),
  AuthController.undoEmailChange,
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
 *       stops working (subsequent refreshes fail with 401 REFRESH_REVOKED),
 *       and forgets every device (with an undo and a restore link, the only
 *       things that do): a login with a device token issued before
 *       emails `new-sign-in`. The answer's `deviceToken` is this device's new
 *       one, issued after that.
 *     responses:
 *       200:
 *         description: All sessions revoked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoggedOutEverywhere'
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
