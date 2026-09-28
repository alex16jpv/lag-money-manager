# Users Module

## What This Module Does

Manages user profiles after registration. Provides read, update, and delete for the authenticated user's **own** profile — there is no way to reach another user's data, and no endpoint that lists users.

Beyond name/email/password, the profile carries three settings that shape the rest of the API:

- **`timezone`** — IANA zone; drives day boundaries in stats and period windows in budgets. Also embedded as a claim in the access token.
- **`currency`** — ISO 4217 alpha code; the user's single money currency, stamped onto accounts, transactions, and budgets. **Locked once the user has accounts.**
- **`locale`** — UI language, `en` (default) or `es`. Purely a preference the front reads to pick copy and `Intl` formatting; it follows the user across devices.

## Files and Responsibilities

| File                                                     | Role                                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/app/routes/userRoutes.ts`                           | Route definitions (`GET /users/:id`, `PUT /users/:id`, `DELETE /users/:id`)                         |
| `src/app/controllers/UserController.ts`                  | Thin HTTP handler, delegates to UserService                                                         |
| `src/app/services/UserService.ts`                        | Self-access enforcement, re-authentication on credential changes, currency lock, password stripping |
| `src/app/dtos/UserDTO.ts`                                | `CreateUserDTO`, `UpdateUserDTO`, `UserResponseDTO`                                                 |
| `src/app/validation/schemas.ts`                          | `updateUserSchema`, `deleteUserSchema`, `idParamSchema`                                             |
| `src/domain/entities/User.ts`                            | User domain entity (`tokenVersion`, `timezone`, `currency`, `locale`, `lastLoginAt`)                |
| `src/domain/repositories/user/IUserRepository.ts`        | Repository interface (adds `getByEmail`, `recordLogin`, `updateWithTokenBump`, `reactivate`, …)     |
| `src/infrastructure/repositories/user/UserRepository.ts` | Mongoose implementation (soft delete, atomic token-version bumps)                                   |
| `src/infrastructure/models/UserModel.ts`                 | Mongoose model (unique lowercase `email`)                                                           |
| `src/app/services/KeepOrStartFreshService.ts`            | The answer to "Keep what's in this account?": keep, or start fresh                                  |
| `src/domain/repositories/userData/IUserDataEraser.ts`    | What Start fresh and It wasn't me erase (the port)                                                  |
| `src/infrastructure/repositories/userData/UserDataEraser.ts` | The erasure itself, collection by collection                                                    |
| `src/app/services/EmailVerificationService.ts`           | The confirmation of the email, and It wasn't me ([auth.md](auth.md#confirming-the-email))           |
| `src/app/services/EmailChangeService.ts`                 | The change of email that waits for the new address ([below](#changing-the-email))                  |

## Public API

### Endpoint Authorization Matrix

| Endpoint            | Auth Required      | Self-Access Enforced | Notes                                                                |
| ------------------- | ------------------ | -------------------- | -------------------------------------------------------------------- |
| `GET /users/:id`    | Yes (access token) | Yes                  | `id` must match the authenticated user's ID, otherwise **404**.      |
| `PUT /users/:id`    | Yes (access token) | Yes                  | Partial updates. Credential changes need `currentPassword`.          |
| `DELETE /users/:id` | Yes (access token) | Yes                  | Soft delete; needs `currentPassword`; responds `200` with a message. |
| `POST /users/:id/email-change`        | Yes (access token) | Yes | A new email that waits for its code; needs `currentPassword` and a captcha. |
| `POST /users/:id/email-change/resend` | Yes (access token) | Yes | Mails the waiting address again; needs a captcha.                        |
| `DELETE /users/:id/email-change`      | Yes (access token) | Yes | Cancels what waits; `200` even when nothing did.                         |
| `POST /users/:id/keep-or-start-fresh` | Yes (access token) | Yes | Only while `keepOrStartFresh` is open.                          |

> There is **no `GET /users`** endpoint — listing users was removed. Self-access failures return `404 User not found`, not `403`, so a user id cannot be confirmed by probing.

### `GET /users/:id`

Get the authenticated user's profile. Returns `UserResponseDTO`: `id`, `name`, `email`, `emailVerified`, `timezone`, `currency`, `locale`, `lastLoginAt`, `keepOrStartFresh`, `createdAt`, `updatedAt`, and, on this route only, `emailVerification` and `emailChange` ([below](#changing-the-email)). The password is never returned, and neither are `emailVerifiedAt` and `dataResetAt`, which stay internal.

`keepOrStartFresh` is `null`, or `{ createdAt, accounts, transactions }` while "Keep what's in this account?" is open (below).

`emailVerified` is in every profile answer (register, login, the reset, the sync feed): whether the address is confirmed ([auth.md](auth.md#confirming-the-email)). `emailVerification` is what the sheet that confirms it needs, and costs one indexed read of `authcodes`, so only this route carries it — `null` once the email is confirmed, otherwise:

| Field               | Meaning |
| ------------------- | ------- |
| `codeLive`          | A code sent in the last 24 hours with tries left: the sheet shows the code field. Otherwise it shows Send code |
| `lastSentAt`        | When the last code went, `null` when none ever did (every account from before email, a failed send) |
| `resendAvailableAt` | When Resend can go again, while that is ahead (`EMAIL_ADDRESS_INTERVAL_SECONDS` after the last). The daily limits answer their own 429 |

### `PUT /users/:id`

Update the profile. Partial updates over `name`, `email`, `password`, `timezone`, `currency`, `locale`; at least one field must be present.

**Changing `email` or `password` requires `currentPassword`** in the same request. A new `email` also drops the account's confirmation (`emailVerifiedAt` back to `null`): a confirmation proves the old address, and keeping it would let somebody confirm their own address and then move the account to someone else's, whose reset would then never ask "Keep what's in this account?". This is re-authentication: a hijacked access token (valid for up to 15 minutes) must not be able to take over the account by swapping the credentials. On success, the user's `tokenVersion` is bumped atomically, so **every refresh token is revoked** and other devices must log in again; every session row is marked revoked too, so Active sessions stops listing the devices it signed out (before T-221 they stayed listed until they expired).

`currency` can only change while the user has **no accounts** (`CURRENCY_LOCKED`). No accounts implies no transactions — every transaction type requires one — so a single account count settles it.

Changing the email to one belonging to another account (soft-deleted included) conflicts with `409 DUPLICATE`; reactivation only happens on register.

**A new address is asked to confirm itself**: once the change is written, `verify-email` goes to it, with the requester's IP brake (the `PUT` carries no device token). A send that fails or is limited does not undo the change: `GET /users/:id` then shows no live code, and the sheet offers Send code. A change that was waiting on `POST /users/:id/email-change` is dropped.

**This `email` is the old way, kept while the web client still uses it**: the account moves at once and confirms afterwards. The way that waits for the new address is [below](#changing-the-email); once the client uses it and is deployed, a task of this repo closes `email` here with `EMAIL_CHANGE_REQUIRES_VERIFICATION`. Closing it before would break the client that is live.

### Changing the email

The account moves to a new address only once that address proves it is reached: the owner's line of 2026-09-26 ("Email and access"), with the screens of the web client's `settings.md` (`#profile-and-security-pending-email`) and `access.md` (`/confirm-email`), and the email `email-change-confirm` of `emails.md`.

1. **`POST /users/:id/email-change`** `{ email, currentPassword, captcha, deviceToken? }` — Save changes with a new email. `currentPassword` re-authenticates (with the per-user limiter of `PUT`), `captcha` is Turnstile's for the action `email-change`, and `deviceToken` lets the email brakes count this device instead of its IP. Nothing moves: the account keeps `email`, and `email-change-confirm` goes to the new address with a 6-digit code and a link (`{APP_URL}/{locale}/confirm-email#token=…`), both for 24 hours. `202 { resendAfterSeconds, emailChange }`.
   - **The change is saved only once its email was accepted, or may have gone** (`sent`, or `failed / unconfirmed`: a provider timed out; the `202` is the same, and the code live before is kept next to the new one): a send that fails leaves the account as it was, with any earlier change still waiting. Unlike Forgot your password?, a failure is said (`EMAIL_SEND_FAILED`, `503` or `422`): the address is the one the person typed.
   - **Refused before anything is sent:** the account's own address (`400 VALIDATION`, on the field `email`), an address any other account holds, a deleted one included (`409 EMAIL_TAKEN`), a wrong password (`401 CURRENT_PASSWORD_INVALID`).
   - **Asking again replaces what waits**: once the new one is saved, the first address's codes are discarded (they would fail anyway, being checked against the address that waits now). Cancel discards them too.
2. **`POST /users/:id/email-change/resend`** `{ captcha, deviceToken? }` — a new code and link to the address that waits, replacing the old ones once accepted; the change then waits 24 hours from this send. `409 EMAIL_CHANGE_NOT_PENDING` when nothing waits.
3. **`DELETE /users/:id/email-change`** — Cancel change. `200` also when nothing waited.
4. **`POST /auth/email/confirm-change`** — the code (with the session) or the link (without one) moves the account ([auth.md](auth.md#post-authemailconfirm-change)).

**What is kept.** `emailChange: { email, sentAt, expiresAt }` on the user document, `null` when nothing waits; it is never in the sync feed and bumps no `updatedAt`. `GET /users/:id` shows it as `emailChange: { email, expiresAt, resendAvailableAt }`, or `null` once its 24 hours passed (a change past `expiresAt` is read as none; the field is simply overwritten by the next one). The codes live in `authcodes` with the purpose `email-change`, but **keyed by the account and the address** (`emailChangeKey`: SHA-256 of the account id and the address's hash), not by the address alone like the others: many accounts can ask for the same new address, and each keeps its own code, tries and link, so one account asking can neither cancel another's code nor turn another's link into its own move ([auth.md](auth.md#the-codes-authcodes)). The email brakes still count the address itself.

**The move is one write** (`UserRepository.applyEmailChange`), guarded by the address that waits and its `expiresAt`: `email`, `emailVerifiedAt` and `firstVerifiedAt` (the new address is proven), `emailChangedAt` (every "It wasn't me" issued before stops working), `emailChange: null` and `tokenVersion + 1`. **The unique index on `email` decides a race**: if another account took the address meanwhile, the write fails on it, the change is dropped and the answer is `409 EMAIL_TAKEN`, with the account untouched. Then every session row is revoked, the invitations waiting for the new address are touched so they reach the feed (`touchUnansweredFor`), and, when this device keeps its session, a new one is opened.

**What waits for T-211.** The notice to the old address (`email-change-requested`, only when that address was confirmed), its "Undo the change" (`/undo`, 7 days, even after the move) and the old address staying reserved while that undo works are the security notices of T-211, which build on this. Until then the old address hears nothing and is free once the account leaves it.

### `DELETE /users/:id`

**Requires `currentPassword`** in the body (`{ "currentPassword": "…" }`), for the same reason as a credential change: a hijacked 15-minute access token must not be able to delete the account, and a deleted account is one step from being taken over by whoever registers its email. A wrong one answers `401 CURRENT_PASSWORD_INVALID` and nothing is touched.

**Password guesses are limited per user.** Every `PUT` or `DELETE /users/:id` that carries `currentPassword` spends a `current-password:<userId>` counter with the login's per-device cap (`AUTH_RATE_LIMIT_MAX` per 15 minutes, refunded on success): a stolen token gets the same budget of guesses as the login, not the API's general one. Past it, `429 RATE_LIMITED`.

**Soft delete.** Sets `deletedAt` and bumps `tokenVersion`; the account and its financial history are kept, and registering again with the same email **and the password it had** reactivates it. Responds `200` with a message. The only hard deletes in the API are the owner's two named exceptions: Start fresh (below) and "It wasn't me" of the verification email ([below](#it-wasnt-me-an-account-that-used-somebody-elses-address)).

### Keep what's in this account?

Somebody can register with an address that is not theirs and never confirm it. Whoever holds the inbox
takes the account back with Forgot your password? ([auth.md](auth.md#post-authpasswordreset)), and then may
not want what the other person put in it (the owner's decision 12 of 2026-09-26). So a reset of an account
whose email **was never confirmed** and that holds accounts or transactions opens a question, in the same
atomic write as the new password:

```json
"keepOrStartFresh": { "createdAt": "2025-06-01T…", "accounts": 2, "transactions": 31 }
```

- **When the account was created and what it held then**: never a name or anything somebody typed. An
  account with neither accounts nor transactions has nothing to keep and is not asked. A confirmed
  account is never asked. Every account that existed before `emailVerifiedAt` counts as never confirmed
  (decision 4); the reset confirms one, like its code or link ([auth.md](auth.md#confirming-the-email)).
  Changing the email takes the confirmation away (above).
- **It stays open until it is answered**, in every profile answer (login, `GET /users/:id`, the sync
  feed), so a client that closes lands on it again. A second reset before the answer keeps the first
  question and its facts.

`POST /users/:id/keep-or-start-fresh` answers it, and answers the profile. **Only a session opened by
the reset or after it may answer**: the access token's `iat` must not be older than the question
(`401` otherwise). An access token of whoever created the account lives up to 15 minutes after the
reset; without this, their app could show them the question and let them press Keep before the owner
of the inbox ever saw it.

- **`{ "choice": "keep" }`** closes it. Nothing else changes.
- **`{ "choice": "start-fresh", "name", "locale", "currency", "timezone" }`** empties the account and
  gives it the profile of the body, as a new account would have: nothing from before stays, not even the
  name. The email and the password just chosen stay.

With no question open: `409 KEEP_OR_START_FRESH_CLOSED` (never asked, already answered, or `keep` after
Start fresh was chosen).

#### What Start fresh does

It is **not one transaction**: an account with years of movements does not fit one. Every step is
idempotent instead, one request runs them at a time, and the question stays open until the last one
lands, so a request that fails half-way is sent again and finishes the job:

1. **The choice is written first, as a claim** (`keepOrStartFresh.startFresh`, with the new profile and
   `claimedUntil`, five minutes on). From then on `keep` is refused, so two tabs cannot answer both
   ways. A second start-fresh while the claim holds is `409 START_FRESH_IN_PROGRESS`, so a double tap
   cannot erase what the first one's account already got afterwards. A request that fails frees its
   claim on the way out; one that dies frees it when the five minutes pass. Either way the retry
   resumes.
2. **Shared, as deleting an account does:** every invitation it sent that is waiting or joined is
   `WITHDRAWN`, so the guests' copies drop those groups; every group it joined reads `LEFT` to its
   owner, who keeps the person and the money as they stood ([invitations.md](invitations.md)).
3. **The erasure, for good** (`UserDataEraser`): transactions, settlements, shared expenses, the shared
   ledger rows (`sharedcounterparties`) and budgets; then shared groups, contacts, accounts and
   categories; then the first ones again, since a write that landed before its account, category or
   group went would point at nothing (a write after that finds no parent and is refused).
   - The invitations it sent are **kept, and handed to `retired:<userId>`**, any still live becoming
     `WITHDRAWN` in the same write: the guests' copies learn from them that the groups ended, and this
     account's own feed no longer carries the addresses and names somebody else typed.
   - The invitations it answered stay with their owners, who read `LEFT` or `DECLINED`, and their
     `inviteeId` becomes `retired:<userId>` too, so the account no longer finds them. The ones still
     waiting for its address are the address's, and stay.
   - Kept on purpose: sync operations and idempotency keys (they expire on their own, and without them a
     retried write from an old device would be applied again), refresh sessions, rate counters and the
     email records.
4. **The default categories are seeded again**, by `seedKey`, so a retry adds none twice.
5. **The profile and the close, in one write:** name, locale, currency (free again: there are no accounts)
   and time zone from the choice, `keepOrStartFresh: null`, and `dataResetAt`, the instant of the reset.

**Every copy synced before is out of date**, and the feed cannot say so row by row: an erased row leaves
no tombstone. So a cursor carries the `dataResetAt` it was issued under, and `GET /sync/changes` with one
from before answers `409 RESYNC_REQUIRED`: the client drops its copy and asks for a snapshot
([sync.md](sync.md)).

**Why hard delete here.** The screen promises "Everything in this account is deleted for good", and the
owner chose it over hiding the rows (2026-09-26): archived accounts and categories would come back in
Archived, and what somebody else put in the account would stay in it. It is the first of the two named
exceptions to "nothing is deleted" (`CLAUDE.md` §2).

An access token of the person who created the account lives up to 15 minutes after the reset, like any
access token after a revocation ([auth.md](auth.md#token-revocation-model)). It cannot answer the
question, and what it writes before Start fresh finishes is erased with the rest; what it writes after,
within those minutes, stays. It could also call `POST /auth/logout-all` and sign the owner out once,
which a new sign-in with the new password undoes.

### It wasn't me: an account that used somebody else's address

The `verify-email` of an account that **never confirmed any address** carries "It wasn't me" (the owner's
decision 11 of 2026-09-26): whoever holds the inbox can delete, for good, an account that signed up with
it and never confirmed it, and have the address free at once, without going through Forgot your
password?. An account confirmed once is not an occupation, whatever its address today: `firstVerifiedAt`
is set by its first confirmation and never cleared (unlike `emailVerifiedAt`, which a new email drops),
and its `verify-email` goes without the "Didn't sign up?" box. Without that, whoever held a mistyped new
address could erase an account with years in it. `POST /auth/email/not-me { token }`
([auth.md](auth.md#post-authemailnot-me)).

**The token is signed, not stored.** It must keep working in every verification email for as long as the
account stays unconfirmed — with no deadline, and Resend must not cancel it — which outlives every code,
so a row in `authcodes` (24 hours) cannot hold it. It is 72 bytes in base64url (96 characters): the
account's id, when it was issued (ms), 16 random bytes (so each email has its own link) and an
HMAC-SHA256 with `JWT_SECRET` over the id, the SHA-256 of the address it went to, and those two. So it
names one account **and** one address: for another address the HMAC does not match; one issued before
the account's last change of address (`emailChangedAt`, stamped by every new email) is refused, so
moving away and back does not bring old links back; once the account is confirmed, it is refused; once
it is gone, there is nothing to name. A rotated `JWT_SECRET` ends every one of them, which Forgot
your password? still covers.

**It works on a deleted account too**, as long as it never confirmed its email: a soft-deleted account
keeps its address taken (only its password brings it back, T-153), and the inbox's owner could otherwise
never register with it.

What it does, in order — not one transaction, like Start fresh; each step is idempotent and a retry
finishes the job:

1. **The claim** (`claimErasure`): one conditional write, only while the account still has that address,
   has never been confirmed and has not changed its address since the token was issued, sets `deletedAt` (if not set) and `erasingAt`, and bumps `tokenVersion`.
   From then on no read finds it (every read filters `deletedAt`), no login, refresh or device token
   works, no confirmation can land, and no register brings it back (`getDeletedByEmail` skips
   `erasingAt`). A confirmation that lands first makes the claim match nothing: `LINK_INVALID`, nothing
   erased. A retry finds the account by its `erasingAt` and goes on.
2. **Its sessions revoked**, and **its invitations ended as when an account is deleted**: what it sent,
   waiting or joined, `WITHDRAWN`; what it joined, `LEFT`.
3. **The erasure** (`UserDataEraser.eraseAccount`): what Start fresh erases ([below](#what-start-fresh-does)),
   then its refresh sessions and every `authcodes` row of its address.
4. **The account itself** (`eraseForGood`), a `deleteOne` guarded by `erasingAt`: the unique index on
   `email` lets the next register take the address at once. No `account-deleted` is sent: the account
   was never that address's.

An access token of the account lives up to 15 minutes after the claim, as after any revocation; what it
writes after the erasure belongs to an account that no longer exists and nobody can reach.

## Internal Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant AUTH as Auth MW
    participant VAL as Validation
    participant CTRL as UserController
    participant SVC as UserService
    participant REPO as UserRepository
    participant DB as Database

    C->>AUTH: GET /users/:id (Bearer access token)
    AUTH->>VAL: req.user = { userId, email, timezone }
    VAL->>CTRL: Validated params
    CTRL->>CTRL: Extract userId from req.user
    CTRL->>SVC: getUserById(id, userId)
    SVC->>SVC: Check id === userId (self-access)
    alt Not own profile
        SVC->>C: throw ApiError("NotFound")
    end
    SVC->>REPO: getById(id)
    REPO->>DB: findOne({ _id, deletedAt: null })
    DB->>REPO: User document
    REPO->>SVC: User entity
    SVC->>SVC: toResponseDTO() — strip password and tokenVersion
    SVC->>CTRL: UserResponseDTO
    CTRL->>C: 200 + user JSON
```

### Credential Change (PUT with email or password)

```mermaid
sequenceDiagram
    participant SVC as UserService
    participant ACCT as AccountRepository
    participant REPO as UserRepository

    Note over SVC: 1. Self-access check (id === userId)
    alt currency in the patch
        SVC->>ACCT: countByUserId(id)
        Note over SVC: > 0 and the value changes → 400 CURRENCY_LOCKED
    end
    alt email or password in the patch
        SVC->>REPO: getByIdWithPassword(id)
        SVC->>SVC: bcrypt.compare(currentPassword, stored)
        Note over SVC: Mismatch or missing → 401 CURRENT_PASSWORD_INVALID
        SVC->>SVC: Hash the new password when present
        SVC->>REPO: updateWithTokenBump(id, fields)
        Note over REPO: Atomic $inc tokenVersion — a concurrent<br/>logout-all must never lose a revocation
    else Plain profile fields
        SVC->>REPO: update(id, fields)
    end
    Note over SVC: currentPassword is stripped, never persisted
```

## Dependencies

**Imports:** `bcryptjs`, `shared/constants`, `shared/errors`, `domain/entities/User`, `domain/repositories/user/IUserRepository`, `domain/repositories/account/IAccountRepository` (to decide whether the currency is still changeable), DTOs

**Imported by:**

- User routes registered in `src/app.ts` at `/users`, after `authMiddleware`
- `AuthService` uses `IUserRepository` for register/login/refresh and token-version bumps
- `AccountService` and `BudgetService` read the owner's `currency` when stamping new records
- `StatsController` and `BudgetController` fall back to the stored `timezone` when the token carries no claim

## Environment Variables

| Variable             | Used for                      |
| -------------------- | ----------------------------- |
| `BCRYPT_SALT_ROUNDS` | Re-hashing password on update |

## Error States

| Error / code               | Status | Condition                                                                             |
| -------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `VALIDATION`               | 400    | Invalid input, or `currentPassword` missing while changing email/password or deleting |
| `BadRequest`               | 400    | User ID in body doesn't match URL param                                               |
| `CURRENCY_LOCKED`          | 400    | Changing `currency` while the user already has accounts                               |
| `Unauthorized`             | 401    | Missing, invalid or expired access token                                              |
| `CURRENT_PASSWORD_INVALID` | 401    | `currentPassword` is wrong (credential change or delete)                              |
| `NotFound`                 | 404    | User does not exist, **or the id is not the authenticated user's**                    |
| `DUPLICATE`                | 409    | Email already used by another account (unique index), on `PUT`                        |
| `EMAIL_TAKEN`              | 409    | The new email belongs to another account: asking for it, or confirming it once taken  |
| `EMAIL_CHANGE_NOT_PENDING` | 409    | Resend, or the code of a change, when nothing waits (confirmed, cancelled, 24 h past) |
| `EMAIL_SEND_FAILED`        | 422/503 | The email to the new address did not go: nothing was saved, or the old code still works |
| `KEEP_OR_START_FRESH_CLOSED` | 409  | Answering "Keep what's in this account?" when it is not open                          |

## Soft Delete and Reactivation

`UserRepository.delete()` sets `deletedAt` and increments `tokenVersion` — it never removes the document (Start fresh, above, removes what an account holds, never the account; only It wasn't me removes an account, and only one that never confirmed its email). Every read path filters on `deletedAt: null`, so a deleted user disappears from the API while their accounts, transactions, categories, and budgets stay intact.

`AuthService.register()` looks up soft-deleted accounts by email first. Only when the password sent matches the one the account had (the owner's decision of 2026-09-23, T-153) does it call `reactivate()`, which clears `deletedAt`, applies the new name (and timezone and locale, if sent), bumps `tokenVersion` again, and returns `user.reactivated: true`; any other password answers `409 EMAIL_TAKEN`, exactly like a live account, so a recycled email or someone who deleted the account through a stolen session never gets the history. The original `currency` is preserved, because the restored history is denominated in it.

## How to Extend

- To add user roles/permissions: add a `role` field to the User entity and DTO, and add authorization logic in the service — there is currently no admin surface at all
- To add profile picture: add a field to entity/model, handle the upload in a new middleware
- Password changes must keep going through `updateWithTokenBump()`: re-hashing without bumping `tokenVersion` would leave stolen refresh tokens alive
- Never widen `UserResponseDTO` with `password` or `tokenVersion`; both are internal
