import { RequestHandler, Router } from "express";

import { ENVIRONMENT } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import { UserController } from "../controllers/UserController";
import { createCaptchaVerifier } from "../factories/captchaFactory";
import { authRateLimit } from "../middlewares/authRateLimitMiddleware";
import { requireCaptcha } from "../middlewares/captchaMiddleware";
import {
  deleteUserSchema,
  idParamSchema,
  keepOrStartFreshSchema,
  requestEmailChangeSchema,
  resendEmailChangeSchema,
  updateUserSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

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

// Before validation, which would drop the field and answer 200 with the email unchanged.
const refuseEmail: RequestHandler = (req, _res, next) => {
  const body: unknown = req.body;
  if (typeof body === "object" && body !== null && "email" in body) {
    throw new ApiError(
      "BadRequest",
      "The email changes through POST /users/{id}/email-change, once the new address confirms it",
      "EMAIL_CHANGE_REQUIRES_VERIFICATION",
      [
        {
          field: "email",
          message: "Confirm the new address to change the email",
        },
      ],
    );
  }
  next();
};

const emailChangeLimiter = authRateLimit({
  keyPrefix: "email-change",
  max: ENVIRONMENT.AUTH_IP_RATE_LIMIT_MAX,
  windowMs: 15 * 60 * 1000,
});
const captcha = createCaptchaVerifier();

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
 *     description: >
 *       The profile, and while its email is not confirmed, what the sheet
 *       that confirms it needs (`emailVerification`); while a new address
 *       waits for its code, what the card of the pending address needs
 *       (`emailChange`).
 *     responses:
 *       200:
 *         description: User found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserWithEmailVerification'
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
 *       Changing `password` requires `currentPassword` (re-authentication)
 *       and revokes every refresh token — other devices must log in again.
 *       `currency` can only change while the user has no accounts
 *       (mono-currency mode). The email does not change here: a body with
 *       `email` is refused whole, before its password or its fields are
 *       checked, and nothing is written; it changes through
 *       `POST /users/{id}/email-change`, once the new address confirms it.
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
 *           Validation error, e.g. missing currentPassword when changing the
 *           password (code VALIDATION); an `email` in the body (code
 *           EMAIL_CHANGE_REQUIRES_VERIFICATION); or currency change while
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
  refuseEmail,
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

/**
 * @openapi
 * /users/{id}/keep-or-start-fresh:
 *   post:
 *     tags: [Users]
 *     summary: Answer "Keep what's in this account?"
 *     description: >
 *       Open only while `keepOrStartFresh` is set: after a password reset of
 *       an account that had never confirmed its email and held something, so
 *       whoever created it may not own the inbox. It stays open until it is
 *       answered. `keep` closes it and changes nothing. `start-fresh`
 *       deletes for good the account's accounts, transactions, budgets,
 *       categories, contacts and the shared groups it created with their
 *       expenses and payments; stops sharing those groups and leaves the ones
 *       it joined, as deleting an account does; seeds the default categories
 *       again; and sets the profile from the body, the currency free again.
 *       The email and the password stay. Only a session opened by the reset
 *       or after it may answer. A start-fresh that fails half-way stays open
 *       and chosen: send it again to finish it (a `keep` is then refused). Every copy of the account's data synced before it is out
 *       of date: `GET /sync/changes` with an older cursor answers
 *       RESYNC_REQUIRED.
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
 *             $ref: '#/components/schemas/KeepOrStartFreshInput'
 *     responses:
 *       200:
 *         description: Answered; `keepOrStartFresh` is null again
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error (code VALIDATION)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: >
 *           Missing, invalid or expired access token, or one issued before
 *           the question was asked: only a session opened by the reset (or
 *           after it) may answer
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
 *         description: >
 *           No question is open: never asked, already answered, or `keep`
 *           after Start fresh was chosen (code KEEP_OR_START_FRESH_CLOSED);
 *           or another start-fresh request is still erasing (code
 *           START_FRESH_IN_PROGRESS)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/keep-or-start-fresh",
  validate(keepOrStartFreshSchema),
  UserController.keepOrStartFresh,
);

/**
 * @openapi
 * /users/{id}/email-change:
 *   post:
 *     tags: [Users]
 *     summary: Ask to move the account to a new email
 *     description: >
 *       Save changes with a new email in Password & email. Nothing moves yet:
 *       the account keeps its email, and `email-change-confirm` goes to the
 *       new address, in the account's language, with a 6-digit code and a
 *       link (`/{locale}/confirm-email#token=…`), both for 24 hours. The
 *       account moves once POST /auth/email/confirm-change receives either;
 *       then every other device is signed out. The change is saved only once
 *       its email was accepted, or may have gone (a provider timed out), so a
 *       send that fails leaves any earlier one as it was. Asking again replaces a change that was waiting: its code
 *       and its link stop working. `currentPassword` re-authenticates, as a
 *       password change on PUT /users/{id} does; `captcha` is a Cloudflare
 *       Turnstile token for the action `email-change`; `deviceToken`, from
 *       this device's last login or register, lets the limits count this
 *       device instead of its IP. It is the only way the email changes:
 *       PUT /users/{id} refuses `email` (EMAIL_CHANGE_REQUIRES_VERIFICATION).
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
 *             $ref: '#/components/schemas/RequestEmailChangeInput'
 *     responses:
 *       202:
 *         description: >
 *           The email was accepted for delivery, or may have gone, and the
 *           change waits for its code. `resendAfterSeconds` is the countdown before Resend
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailChangeSent'
 *       400:
 *         description: >
 *           Validation error, the account's own email among them (code
 *           VALIDATION), or Cloudflare refused the captcha token (code
 *           CAPTCHA_INVALID)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: >
 *           Missing, invalid or expired access token, or a wrong
 *           `currentPassword` (code CURRENT_PASSWORD_INVALID)
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
 *         description: >
 *           The address belongs to another account, a deleted one included
 *           (code EMAIL_TAKEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: >
 *           The address does not accept our emails: it bounced or complained
 *           before, or the provider refused it (code EMAIL_SEND_FAILED).
 *           Nothing was saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: >
 *           Too many requests (code RATE_LIMITED; `Retry-After` in seconds):
 *           password guesses for this account, from this IP, from this
 *           device or IP in the hour, for this account (five verification or
 *           email-change emails a day), or for this address — one a minute
 *           and five a day
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: >
 *           The email could not be sent (code EMAIL_SEND_FAILED), or the
 *           captcha could not be checked (code CAPTCHA_UNAVAILABLE). Nothing
 *           was saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   delete:
 *     tags: [Users]
 *     summary: Cancel the change that waits for its code
 *     description: >
 *       Cancel change on the card of the pending address. Its code and its
 *       link stop working, and the account keeps its email. Answers 200 also
 *       when nothing was waiting, so a retry is safe.
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
 *         description: Nothing waits any more
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
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
router.post(
  "/:id/email-change",
  currentPasswordLimiter,
  emailChangeLimiter,
  validate(requestEmailChangeSchema),
  requireCaptcha("email-change", captcha),
  UserController.requestEmailChange,
);
router.delete(
  "/:id/email-change",
  validate(idParamSchema),
  UserController.cancelEmailChange,
);

/**
 * @openapi
 * /users/{id}/email-change/resend:
 *   post:
 *     tags: [Users]
 *     summary: Email a new code to the address that waits
 *     description: >
 *       Resend on the card of the pending address. Sends
 *       `email-change-confirm` again, with a new code and link for 24 hours
 *       that replace the old ones once the email is accepted; the change
 *       waits 24 hours from this send. `captcha` is a Cloudflare Turnstile
 *       token for the action `email-change`; `deviceToken` as in POST
 *       /users/{id}/email-change.
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
 *             $ref: '#/components/schemas/ResendEmailChangeInput'
 *     responses:
 *       202:
 *         description: >
 *           The email was accepted for delivery, or may have gone.
 *           `resendAfterSeconds` is the countdown before Resend
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailChangeSent'
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
 *         description: User not found (or not the authenticated user's id)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: >
 *           No new email waits: it was confirmed, cancelled or its 24 hours
 *           passed (code EMAIL_CHANGE_NOT_PENDING)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: >
 *           The address does not accept our emails (code EMAIL_SEND_FAILED).
 *           A code that was live before still works
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: >
 *           Too many requests (code RATE_LIMITED; `Retry-After` in seconds):
 *           the limits of POST /users/{id}/email-change, but for password
 *           guesses
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: >
 *           The email could not be sent (code EMAIL_SEND_FAILED), or the
 *           captcha could not be checked (code CAPTCHA_UNAVAILABLE). A code
 *           that was live before still works
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/email-change/resend",
  emailChangeLimiter,
  validate(resendEmailChangeSchema),
  requireCaptcha("email-change", captcha),
  UserController.resendEmailChange,
);

export default router;
