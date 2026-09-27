# Auth Module

## What This Module Does

Handles registration, login, the full refresh-token session lifecycle, and choosing a new password by email (Forgot your password?). Registration, login and the password reset are public; session management requires an access token.

Every successful register or login issues a **token pair**:

- **Access token** — short-lived (`JWT_EXPIRATION`, default 15m), carries `{ userId, email, timezone, sid }`, sent as `Authorization: Bearer <token>`. `sid` is the refresh family the token was issued for; refreshing keeps it, so it identifies the device across rotations.
- **Refresh token** — long-lived (`REFRESH_TOKEN_EXPIRATION`, default 30d), signed with `REFRESH_SECRET` (falling back to `JWT_SECRET`), carries a `jti` that identifies one row in the sessions collection.

Refresh tokens are **truly rotated**: every `POST /auth/refresh` invalidates the presented token and issues a new pair. Replaying an already-rotated token is treated as theft and revokes the entire device session family — with one exception, the **untouched successor** below, which is what tells a replay apart from an answer that never arrived.

## Files and Responsibilities

| File                                                                         | Role                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/app/routes/authRoutes.ts`                                               | Route definitions with OpenAPI docs and the per-route rate limiters           |
| `src/app/controllers/AuthController.ts`                                      | Thin HTTP handler, delegates to AuthService                                   |
| `src/app/services/AuthService.ts`                                            | Hashing, credential verification, token signing, rotation, session revocation |
| `src/app/dtos/UserDTO.ts`                                                    | `CreateUserDTO`, `UserResponseDTO` (shared with Users module)                 |
| `src/app/validation/schemas.ts`                                              | `registerSchema`, `loginSchema`, `refreshSchema`                              |
| `src/app/middlewares/authMiddleware.ts`                                      | Access-token verification; populates `req.user` (`AuthPayload`)               |
| `src/app/services/deviceToken.ts`                                            | Signing and reading the device token that login and register answer           |
| `src/app/middlewares/loginAttempt.ts`                                        | The email an attempt is for, and the device recognized for it                 |
| `src/app/middlewares/authRateLimitMiddleware.ts`                             | The persisted counter behind every auth rate limit                            |
| `src/app/middlewares/clientIp.ts`                                            | The client address the limiters count against                                 |
| `src/domain/repositories/refreshSession/IRefreshSessionRepository.ts`        | Session store contract (`RefreshSession`, `SessionSummary`)                   |
| `src/infrastructure/repositories/refreshSession/RefreshSessionRepository.ts` | Mongoose implementation (atomic `rotate`, family revocation)                  |
| `src/infrastructure/models/RefreshSessionModel.ts`                           | Mongoose model for refresh sessions                                           |
| `src/infrastructure/models/RateLimitModel.ts`                                | Persisted rate-limit counters                                                 |
| `src/app/services/PasswordResetService.ts`                                   | Forgot your password? and the reset: the same answer for every address       |
| `src/app/services/authCodes.ts`                                              | The 6-digit code, the link's token and how each is hashed                    |
| `src/domain/repositories/authCode/IAuthCodeRepository.ts`                    | Store of emailed codes, one row per address and purpose                      |
| `src/infrastructure/repositories/authCode/AuthCodeRepository.ts`             | Mongoose implementation (atomic tries and single use)                        |
| `src/infrastructure/models/AuthCodeModel.ts`                                 | Mongoose model for `authcodes`, with its TTL                                  |
| `src/app/middlewares/captchaMiddleware.ts`                                   | `requireCaptcha(action)`: the Turnstile check before a route's handler        |
| `src/domain/captcha/CaptchaVerifier.ts`                                      | The captcha port                                                              |
| `src/infrastructure/captcha/TurnstileVerifier.ts`                            | Cloudflare Turnstile's `siteverify`                                           |

## Public API

### `POST /auth/register`

Register a new user. **Register also logs in** — the response already carries the token pair, so no follow-up login call is needed.

**Request body:**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "timezone": "America/Bogota",
  "currency": "COP",
  "locale": "en"
}
```

- `password` — 8–128 characters.
- `email` — normalized (trimmed + lowercased), so `John@X.com` and `john@x.com` are the same account.
- `timezone` — optional IANA zone; drives day and period boundaries for stats and budgets. Defaults to `America/Bogota`.
- `currency` — optional ISO 4217 alpha code; defaults to `COP`. It is the user's single money currency and locks once they have accounts.
- `locale` — optional UI language, `en` (default) or `es`.

**Response (201):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "019576a0-d7b6-...",
    "name": "John Doe",
    "email": "john@example.com",
    "timezone": "America/Bogota",
    "currency": "COP",
    "locale": "en",
    "lastLoginAt": "2026-08-31T...",
    "keepOrStartFresh": null,
    "createdAt": "2026-08-31T...",
    "updatedAt": "2026-08-31T..."
  }
}
```

Registration also seeds the user's default categories (failures are logged, never fail the request).

**Reactivation:** registering with the email **and the password** of a **soft-deleted** account revives it with its full financial history. The response carries `user.reactivated: true`, and the original currency is kept — the `currency` sent in that register is ignored. With any other password the answer is `409 EMAIL_TAKEN`, the same as for a live account: the history goes back only to whoever still knows its password (T-153). That makes register a way to test a deleted account's password, so it spends the same per-email budget as a failed login (see Rate Limiting).

Note: the password is never returned.

### `POST /auth/login`

Authenticate and receive a token pair. Response shape is identical to register (without `reactivated`), and `lastLoginAt` is stamped.

**Request body:**

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

Failed logins pay the same bcrypt cost whether the email exists or not, so timing cannot be used to enumerate users.

### `POST /auth/refresh`

Exchange a refresh token for a **new** access + refresh pair. Public (no access token needed); the body is `{ "refreshToken": "..." }`. The response carries no `user`.

Always store the new refresh token: the old one stops rotating the moment it is used, and all it can still do is repeat the answer that never arrived (below). Rotation never extends the family past its original absolute expiry.

#### A lost answer is not a replay

Rotation is written before the answer is sent, so a client that never receives it keeps a token the server has already
rotated, and its next attempt looks exactly like a replay: same `jti`, already spent. It happens for real — the tab
reloads mid-request when a deployment changes the build id, or a phone drops the connection — and paying for it with the
whole 30-day family means a password prompt for a lost packet.

What tells the two apart is the **successor**: nobody can have used the token that never arrived. So when the presented
row is already rotated, the request is answered with the successor's own pair — no new row, no new rotation — as long as
all of this holds:

- the presented row is rotated and its family is alive (a revoked family is answered below, and is not a replay),
- the successor still exists, is not revoked, and has not itself been rotated,
- the family has not expired, and this row has been presented at most **10** times since it was rotated.

**There is no time limit, and that is deliberate.** Until 2026-09-13 the re-issue also required the rotation to be less
than 60 seconds old. That clock added nothing the untouched successor did not already prove, and it killed real
sessions: the client that loses the answer is usually the client that has just died, and it comes back when its user
does, not within the minute. The two families killed on 2026-09-11 and 2026-09-12 presented their token **3 h 41 min**
and **2 h 52 min** after the rotation, and in both the successor had never been touched.

**What replaces the clock is a counter, because without one the rotated row becomes a permanent alias.** While the
successor stays untouched, the old token answers again as often as it is presented — which is what the legitimate
client needs, since the deploy that loses one answer loses the next one too, and a browser with six tabs asks six
times at once. `countReissue` stamps `reissuedAt` and increments `reissueCount` on the rotated row in **one atomic
update**, which is also how the row is read: counting afterwards would let two simultaneous requests see the same
number and the budget would mean nothing. It counts **presentations, not successes** — an attempt that turns out to be
a replay is counted too, and then revokes the family anyway.

Past the tenth, the row is **retired, not treated as theft**: `401 REFRESH_REVOKED`, its own warning
(`Refresh re-issue limit reached; rotated token retired`), and **the family is left alone**. The successor being
untouched is still proof that nobody replayed anything; all the counter knows is that this client is not keeping the
answer. Revoking there would kill the live device for the same blind reason the clock did. The stamp is also what
`GET /auth/sessions` reports as `lastUsedAt`, so a family that lives on re-issues is not shown to its owner as idle.

Anything else is still a replay and still revokes the family. A stolen token buys nothing once the legitimate client
rotates again, which is the case replay detection exists for: while the successor is untouched the thief gets exactly
the pair that client already holds, so any use by either of them brings the collision closer. The case that has no
collision is a client that never comes back — it died, or its user logged in again and opened another family — and there
the counter, not the clock, is what bounds a leaked token.

Each re-issue logs `Refresh answer was lost; successor re-issued` at **warn** with the user, the family and the count:
`warn` because `LOG_LEVEL` may be `warn` in production and this path no longer has a clock around it, and the count
because one lost answer and forty are not the same event.

The three reads — `rotate`, then the presented row, then its successor — are not one transaction. Two requests carrying
the same rotated token are harmless: both are answered with the same pair and neither writes a row. What the gap allows
is a successor rotated by the live client in between, which re-issues a pair whose `jti` is already spent; the theft
detection then fires one attempt later instead of at once.

#### A revoked family is over, not stolen

A logout, a `DELETE /auth/sessions/:id` or an earlier replay leaves every row of the family with `revokedAt`. A client
that presents one of those rows is answered `401 REFRESH_REVOKED` without revoking anything again and **without the
theft warning**: it is a client that had not noticed, not a token being replayed. Only a rotated row in a live family
whose successor is spent, missing or revoked writes `Refresh token reuse detected; family revoked`.

### `POST /auth/logout`

Per-device logout. Authenticated by the refresh token in the body (no access token needed); revokes that token's whole rotation family. Idempotent for an already-revoked session of an otherwise valid token.

A family whose absolute expiry has passed is closed by the rotation that finds it: the row is already
spent by then, and leaving it alive would make the next presentation read as theft instead of as the
`REFRESH_INVALID` it is.

A rotation in flight does not survive it (H-62). `rotate` and the `create` of the new row are two operations, so a logout that lands between them revokes a family whose newest row does not exist yet and would leave that device signed in. The refresh re-reads the row it rotated after writing the new one: if the logout got there first, it revokes the family again — this time with the new row in it — and answers `401 REFRESH_REVOKED`.

### `POST /auth/logout-all`

Global logout for the authenticated user. Bumps the user's `tokenVersion`, so every outstanding refresh token stops working, and marks the session rows revoked. Requires an access token.

### `GET /auth/sessions`

List the user's active device sessions — one entry per rotation family. Responds `{ "data": [...] }` where each `SessionSummary` is:

| Field        | Meaning                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `id`         | The family id (use it to revoke the session)                                             |
| `createdAt`  | When that device logged in (the family root)                                             |
| `lastUsedAt` | Last refresh, re-issue or attempt, or the login when it never refreshed                  |
| `expiresAt`  | Absolute expiry of the family                                                            |
| `userAgent`  | User-Agent captured at login, when sent                                                  |
| `current`    | `true` for the family the requesting access token belongs to (its `sid`); always present |

Access tokens issued before `sid` existed mark no row as current until they are renewed (at most one `JWT_EXPIRATION`). Revoking the current session through `DELETE /auth/sessions/:id` is allowed: it is the same as `POST /auth/logout` for that device.

### `DELETE /auth/sessions/:id`

Revoke one device session by its family id. Idempotent for an own, already-revoked session; `404` when the family is not the user's.

### `POST /auth/password/forgot`

Asks for a code to choose a new password. Body: `{ "email", "captcha", "deviceToken"? }`. `captcha` is a
Cloudflare Turnstile token issued for the action `forgot-password` (see [The captcha](#the-captcha)).

Always `202 { "resendAfterSeconds": 60 }`, whatever happens after the brakes (see
[Forgot your password?](#forgot-your-password-one-answer-for-every-address)). Only a **live** account is
emailed: a deleted one gets nothing (T-153), and neither does an address with no account. The email is
`password-reset` in the account's own language, with a 6-digit code and a link to
`{APP_URL}/{locale}/reset#token=…`, both good for 30 minutes.

### `POST /auth/password/reset`

Chooses the new password. Body: `{ "email", "code", "newPassword" }`, or `{ "token", "newPassword" }` with
the link's token alone, which names the account. A body with both, or with neither, is `400 VALIDATION`.

On success, in one atomic write to the user: the password, `tokenVersion + 1` (every refresh token and
device token issued before stops working, as a password change does) and `emailVerifiedAt`, since the
code or the link proved the inbox. The sessions are marked revoked as in logout-all, and the answer is a
session like a login's: `{ accessToken, refreshToken, deviceToken, user }`. Using the code or the link
spends every code of that request.

When the account **had never confirmed its email** and holds accounts or transactions, the same write
opens "Keep what's in this account?" (the owner's decision 12): `user.keepOrStartFresh` carries when the
account was created and what it held, and the client asks before opening anything. It is answered on
`POST /users/{id}/keep-or-start-fresh` ([users.md](users.md#keep-whats-in-this-account)).

## Forgot your password? One answer for every address

Anybody can type any address, so nothing the endpoint answers may tell an address with an account from
one without, a live account from a deleted one, or a send that worked from one that failed (the front's
`design/spec/screens/access.md`). What makes that hold:

- **The brakes are counted for every address.** `EmailService.holdBrakes` counts the `password-reset`
  template's per-address brakes (one a minute, five a day) and the requester's (10 an hour per recognized
  device, else 5 per IP) before anything is looked up, account or not, and the send that follows passes
  `brakesHeld` so they are not counted twice. A `429` is therefore the same for everyone. Only the money
  caps are left to the send, and they are global, so reaching one tells nothing about an address: the
  request still answers `202` and the `EMAIL_CAP_REACHED` alarm fires ([email.md](email.md#brakes)).
- **Every address leaves the same row.** Each request upserts the address's `authcodes` row (by hash),
  with `userId: null` when there is no account, and starts its tries again: a reset afterwards makes
  the same round trips for any address. The send of an address with an account costs more round trips
  than no send at all; the floor below is what hides them.
- **Nothing after the brakes is shown.** A failed send, a store that fails, an account that is missing:
  all end in the same `202`, and are logged (`PASSWORD_RESET_NOT_SENT`, and the email module's own lines).
  Only an address with an account can fail there, so showing it would name the account.
- **A floor on the time.** The answer waits until `email.providerCeilingMs` plus 500 ms have passed since
  the brakes: the providers' ceiling (1.5 s each) plus the MongoDB round trips of a send (the suppression
  read, the caps, the delivery row, the code). With one provider that is 2 s. A second provider raises it
  on its own.
- **A new code replaces the old one only once its email was accepted** (`sent`). When a provider timed out
  without an answer (`failed / unconfirmed`) the email may still arrive, so the newest live code is kept next
  to the new one and either works until one is used. Any other failure leaves the old code as it was.

### The codes: `authcodes`

| Field       | Meaning                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| `purpose`   | `reset` (the verification and the email change of T-209 and T-221 will add theirs)          |
| `toHash`    | SHA-256 of the normalized address; unique with `purpose`. Never the address                 |
| `userId`    | The account the request found, `null` when there was none                                   |
| `codes`     | At most two live codes, each `{ codeHash, tokenHash, expiresAt }`                           |
| `attempts`  | Tries of a code since the last one was issued                                               |
| `expiresAt` | TTL: the row goes when its newest code does                                                  |

- **The code is keyed, the token is not.** `codeHash` is HMAC-SHA256 with `JWT_SECRET` over the address's
  hash and the six digits: without a secret, a copy of the database would give every code back in a
  million guesses. The token is 32 random bytes, so its plain SHA-256 (`tokenHash`, indexed) is enough.
- **Five tries per code**, counted in one atomic `$inc` guarded by `attempts < 5` before the code is even
  compared, so parallel guesses cannot go past it. An address with no account counts its tries the same
  way. Every Send code starts the count again, account or not, so a code gets its five tries and an
  address at most 25 a day. The link is not counted: its token cannot be guessed.
- **Single use** is one `findOneAndUpdate` that empties `codes` only if the code presented is still in
  them and live, so of two resets with the same code exactly one gets through.
- **One answer for a bad code**, `RESET_CODE_INVALID`: mistyped, expired, replaced, spent in five tries,
  or for an address with no account. With two, "expired" would exist only for the addresses with an
  account. A code for an address the account no longer has (its email changed since) is refused too.
  The link has its own, `LINK_INVALID`, like every link of an email.
- **The new password is hashed first**, before the code is looked at, so a right and a wrong code pay
  the same bcrypt time.

### What the reset leaves for later

- **A second factor.** The day two-step verification exists (T-217), the reset will need two different
  proofs among the emailed code, the TOTP and a recovery code (two recovery codes are not two). The check
  goes between redeeming the code and writing the password, in `PasswordResetService.reset`, and the body
  gains its optional `totp` and `recoveryCode` then, with `SECOND_FACTOR_REQUIRED`: today there is no
  factor, so the contract promises neither a field nor a code nothing reads.
- **Factors of an account that never confirmed its email.** When passkeys, TOTP and recovery codes exist,
  a reset of an account whose `emailVerifiedAt` was null also removes them: whoever registered somebody
  else's address may have left one there. Today none exist.
- **The "Password changed" notice** is sent by T-211 with the other security notices.

## The captcha

`requireCaptcha(action, verifier)` runs after `validate()`, on the routes that send an email to an address
anybody can type: today `POST /auth/password/forgot` with the action `forgot-password`. It asks Cloudflare
Turnstile's `siteverify` (`TurnstileVerifier`, 3 s, no retry) with `TURNSTILE_SECRET`, the token and the
client's whole address (`clientAddress`: `clientIp` collapses IPv6 to its /56, which is right for a limit
and wrong for Cloudflare).

- **It passes** when Cloudflare says so, for the hostname of `APP_URL` and the route's action. With one of
  Cloudflare's test secrets, which answer their own hostname and action, those two are not compared;
  production refuses to start with a test secret.
- **Refused** (`400 CAPTCHA_INVALID`): the token was spent, expired, forged, or issued for another site or
  action. The client asks the widget for a new one; a token works once and lasts 300 s.
- **Unavailable** (`503 CAPTCHA_UNAVAILABLE`, logged as an error with the reason): Cloudflare did not
  answer, answered something else, could not judge the token, or no secret is set. Nothing is sent: the
  captcha is what keeps strangers from spending the email budget, so it fails closed.

The check is here and not only in the web client's server, because a call straight to the Function URL
would skip it. In production `EMAIL_PROVIDERS` with no `TURNSTILE_SECRET` stops the API from starting.

## Internal Flow

### Register and Login

```mermaid
sequenceDiagram
    participant C as Client
    participant V as Validation
    participant CTRL as AuthController
    participant SVC as AuthService
    participant REPO as UserRepository
    participant SESS as RefreshSessionRepository

    alt Registration
        C->>V: POST /auth/register { name, email, password, timezone?, currency?, locale? }
        V->>CTRL: Validated data (email normalized)
        CTRL->>SVC: register(dto, userAgent)
        SVC->>SVC: Hash password (bcryptjs)
        SVC->>REPO: getDeletedByEmail(email)
        alt Soft-deleted account, same password
            SVC->>REPO: reactivate(id, { name, password, timezone?, locale? })
            Note over SVC: user.reactivated = true, currency kept
        else Soft-deleted account, other password
            SVC->>CTRL: 409 EMAIL_TAKEN
        else New user
            SVC->>REPO: create(user)
            SVC->>SVC: seedDefaultCategories(userId) — failures logged only
        end
        SVC->>SVC: openSession(user, userAgent)
        SVC->>CTRL: { accessToken, refreshToken, user }
        CTRL->>C: 201 + token pair + user JSON
    end

    alt Login
        C->>V: POST /auth/login { email, password }
        V->>CTRL: Validated data
        CTRL->>SVC: login(email, password, userAgent)
        SVC->>REPO: getByEmail(email)
        alt No such user
            SVC->>SVC: bcrypt.compare against a dummy hash (timing equalization)
            SVC->>C: 401 Invalid email or password
        end
        SVC->>SVC: Compare password (bcryptjs)
        SVC->>SVC: openSession(user, userAgent)
        SVC->>SESS: create({ jti, familyId: jti, expiresAt, userAgent })
        SVC->>REPO: recordLogin(userId) — stamps lastLoginAt
        SVC->>CTRL: { accessToken, refreshToken, user }
        CTRL->>C: 200 + token pair + user JSON
    end
```

### Refresh Rotation and Reuse Detection

```mermaid
sequenceDiagram
    participant C as Client
    participant SVC as AuthService
    participant REPO as UserRepository
    participant SESS as RefreshSessionRepository

    C->>SVC: POST /auth/refresh { refreshToken }
    SVC->>SVC: Verify signature, type, and payload shape
    SVC->>REPO: getById(userId)
    alt tokenVersion mismatch
        SVC->>C: 401 REFRESH_REVOKED (password/email change or logout-all)
    end
    SVC->>SESS: rotate(jti, newJti) — atomic, only succeeds on an ACTIVE session
    alt rotate returned a session
        SVC->>SESS: create({ jti: newJti, familyId, expiresAt })
        Note over SVC: New refresh token expires with the family,<br/>never later — no sliding sessions
        SVC->>SESS: findById(jti) — the row just rotated, read again
        alt It is revoked now, or gone
            Note over SVC: A logout landed between the rotation and the new row,<br/>which it could not revoke because it did not exist
            SVC->>SESS: revokeFamily(familyId)
            SVC->>C: 401 REFRESH_REVOKED (re-login required)
        else Still the live row
            SVC->>C: 200 { accessToken, refreshToken }
        end
    else rotate returned null, but the jti exists
        alt The family is already revoked
            Note over SVC: A logout ended it: over, but nobody replayed anything
            SVC->>C: 401 REFRESH_REVOKED (re-login required)
        else
            SVC->>SESS: countReissue(jti) — stamps the row and counts this re-issue
            SVC->>SESS: findById(replacedBy) — the successor of the presented row
            alt The successor is untouched and the count is within the limit
                Note over SVC: The answer that carried it never arrived:<br/>same client asking again, not a replay
                SVC->>C: 200 { accessToken, refreshToken } — the successor's own pair
            else The successor is untouched but the count is spent
                Note over SVC: This row is over, the family is not:<br/>no proof of theft, so nothing is revoked
                SVC->>C: 401 REFRESH_REVOKED (re-login required)
            else Anything else
                Note over SVC: Reuse of a rotated token — theft or a duplicated client
                SVC->>SESS: revokeFamily(familyId)
                SVC->>C: 401 REFRESH_REVOKED (re-login required)
            end
        end
    else jti unknown
        SVC->>C: 401 REFRESH_INVALID
    end
```

## Dependencies

**Imports:**

- `bcryptjs` — Password hashing and comparison
- `jsonwebtoken` — Token signing and verification
- `uuid` (v7) — `jti` / family ids
- `shared/constants` — `ENVIRONMENT` (secrets, expirations, salt rounds, rate-limit caps)
- `shared/errors` — `ApiError`
- `domain/entities/User` — User entity
- `domain/repositories/user/IUserRepository` — user data access
- `domain/repositories/refreshSession/IRefreshSessionRepository` — session store
- `app/services/CategoryService` — seeds default categories on registration

**Imported by:**

- Auth routes are registered in `src/app.ts` at `/auth`, **before** the global `authMiddleware`
- `authMiddleware` is applied globally to every route registered after it (`/users`, `/accounts`, `/categories`, `/transactions`, `/budgets`, `/stats`)
- Inside `authRoutes.ts`, `/auth/logout-all` and the `/auth/sessions` routes attach `authMiddleware` explicitly

## Environment Variables

| Variable                   | Used for                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ |
| `JWT_SECRET`               | Signing and verifying access tokens                                            |
| `REFRESH_SECRET`           | Signing refresh tokens; falls back to `JWT_SECRET` when unset                  |
| `JWT_EXPIRATION`           | Access-token lifetime (default: `15m`)                                         |
| `REFRESH_TOKEN_EXPIRATION` | Refresh-token / session-family lifetime (default: `30d`)                       |
| `BCRYPT_SALT_ROUNDS`       | Password hashing complexity (default: `12`)                                    |
| `AUTH_RATE_LIMIT_MAX`      | Failed login attempts per recognized device, or per email and client IP, per 15-minute window (default: `10`) |
| `AUTH_EMAIL_RATE_LIMIT_MAX` | Failed login attempts per email per hour from unrecognized devices (default: `50`) |
| `AUTH_IP_RATE_LIMIT_MAX`   | Login and register attempts per client IP per 15-minute window (default: `60`) |
| `REFRESH_RATE_LIMIT_MAX`   | Refresh and logout attempts per 15-minute window (default: `60`)               |
| `TURNSTILE_SECRET`         | Cloudflare Turnstile's secret key for the captcha; required in production once `EMAIL_PROVIDERS` is set |

## Rate Limiting

`authRateLimit` keeps one fixed window per key:

| Endpoint                        | Key                                                   | Cap and window                            |
| ------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| `POST /auth/login`, `/register` | Client IP                                             | `AUTH_IP_RATE_LIMIT_MAX` per 15 min       |
| `POST /auth/login`, `/register` | Recognized device (`login-device:<device id>`)        | `AUTH_RATE_LIMIT_MAX` per 15 min          |
| `POST /auth/login`, `/register` | Otherwise email and client IP (`login-email-ip:<email>:<ip>`) | `AUTH_RATE_LIMIT_MAX` per 15 min  |
| `POST /auth/login`, `/register` | Otherwise email (`login-email:<email>`)               | `AUTH_EMAIL_RATE_LIMIT_MAX` per hour      |
| `POST /auth/refresh`, `/logout` | Client IP                                             | `REFRESH_RATE_LIMIT_MAX` per 15 min       |
| `POST /auth/password/forgot`    | Client IP (`forgot:<ip>`), before the captcha         | `AUTH_IP_RATE_LIMIT_MAX` per 15 min       |
| `POST /auth/password/forgot`    | Then the email's own brakes, for every address        | See [One answer for every address](#forgot-your-password-one-answer-for-every-address) |
| `POST /auth/password/reset`     | Client IP (`reset:<ip>`)                              | `AUTH_IP_RATE_LIMIT_MAX` per 15 min       |

Only **failed** attempts burn the account budgets (`refundOnSuccess`), so real logins cost nothing. Register spends the same ones, because registering with a deleted account's email tests its password: a failed register and a failed login spend one budget between them.

**Nobody can lock another person out of a device they already use** (T-176, owner's decision of 2026-09-24). Until then the only account budget was one counter per email: ten wrong passwords from anyone locked the owner out for the window, and repeating it every fifteen minutes locked them out for good. The fix is a device token, the "device cookie" OWASP recommends against lockout attacks:

- Every login and register answers a `deviceToken`: an HS256 JWT signed with `REFRESH_SECRET ?? JWT_SECRET`, audience `device`, a random `jti` (the device id), the user's `tokenVersion`, a `sub` that is the SHA-256 of the normalized email, and a one-year lifetime (`src/app/services/deviceToken.ts`). It proves only that this device once signed in to that email; it opens nothing, so it is not a session and survives logout. The web client keeps it in an httpOnly cookie and sends it back as `deviceToken` on the next login or register. Each success answers a new one, which the client keeps instead; the old one stays valid until it expires or is revoked.
- **Recognizing** a device (`AuthService.recognizedDevice`, run once per request by `AuthController.recognizeDevice` before the limiters) takes a valid signature, the email the attempt is for, and a `tokenVersion` equal to the account's, which costs one indexed read. A password or email change and **Log out everywhere** bump `tokenVersion`, so they revoke every device token issued before; a deleted account recognizes none.
- An attempt from a recognized device counts only against that device (`AUTH_RATE_LIMIT_MAX` per 15 minutes). Someone else's failures never touch that budget. A stolen token, or one kept by somebody who once knew the password, is worth that budget of guesses, outside the per-email cap, until the owner changes the password or logs out everywhere.
- Every other attempt counts twice: per email and client IP, so an attacker behind one address runs out of guesses without affecting anybody else; and per email across all addresses, so an attack that rotates addresses is capped at `AUTH_EMAIL_RATE_LIMIT_MAX` guesses an hour. Only that last one can still stop the real owner, and only on a device the account does not recognize, while the attack lasts.

A token for another email, a forged one, an expired one or a revoked one counts as no token. The limiters run in a chain, and one that refuses does not give back what the earlier ones counted: an owner who keeps retrying from an unrecognized device while the per-email cap is full also spends their own email-and-IP budget, and may wait up to fifteen minutes more after the attack stops. `PUT` and `DELETE /users/:id` with `currentPassword` spend a counter per user (`current-password:<id>`) with `AUTH_RATE_LIMIT_MAX`: reaching them takes that user's own session, so no stranger can lock them.

The per-IP cap is shared by everyone behind that address — a carrier NAT holds thousands of unrelated users — so it is a volume brake, not a per-person allowance, and it defaults to `60`.

"Client IP" is `clientIp` (`src/app/middlewares/clientIp.ts`), not `req.ip`. Behind the Lambda Function URL `req.ip` is the caller of the API, which for the web client is the frontend's server, one address for every user of the app: keying on it gave all logins a single shared budget. The frontend states the real address in `x-client-ip`, believed only on a request that carried a valid `x-api-secret` (the mark `gatewaySecretMiddleware` leaves), validated with `net.isIP` and normalized with `ipKeyGenerator`. A caller that sends no such header, a direct client among them, is still limited by `req.ip`. See `docs/guides/deployment.md` for the whole chain.

## Error States

| Error / code      | Status | Condition                                                                                                                                                                                                                                  |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VALIDATION`      | 400    | Invalid email format, password shorter than 8 chars, invalid timezone/currency/locale                                                                                                                                                      |
| `Unauthorized`    | 401    | Invalid email or password on login (uniform for unknown email and wrong password)                                                                                                                                                          |
| `REFRESH_INVALID` | 401    | Refresh token malformed, expired, or its `jti` is unknown                                                                                                                                                                                  |
| `REFRESH_REVOKED` | 401    | Reuse of a rotated token whose successor is already spent; a rotated token presented past its re-issue limit; a family already ended by a logout or `DELETE /auth/sessions/:id`; or a token that predates a logout-all / credential change |
| `Unauthorized`    | 401    | Missing or malformed `Authorization` header, or an invalid/expired access token                                                                                                                                                            |
| `NotFound`        | 404    | `DELETE /auth/sessions/:id` for a family that is not the user's                                                                                                                                                                            |
| `EMAIL_TAKEN`     | 409    | Register with the email of a live account, of a soft-deleted one with a different password, or one a concurrent register just reactivated                                                                                                  |
| `RATE_LIMITED`    | 429    | Too many attempts in the window                                                                                                                                                                                                            |
| `RESET_CODE_INVALID` | 400 | A reset code that does not work, whatever the reason (see above)                                                                                                                                                                         |
| `LINK_INVALID`    | 400    | A reset link that was used, expired or replaced                                                                                                                                                                                            |
| `CAPTCHA_INVALID` | 400    | Turnstile refused the captcha token                                                                                                                                                                                                        |
| `CAPTCHA_UNAVAILABLE` | 503 | The captcha could not be checked; nothing was sent                                                                                                                                                                                     |

> On a `500` during register the user may still have been created — clients should try login before retrying register.

## Token Revocation Model

Two independent mechanisms invalidate refresh tokens:

1. **`tokenVersion`** on the user document. `logout-all`, a password change, a password reset and an email change all bump it; every outstanding refresh token then fails with `REFRESH_REVOKED`. Access tokens already issued stay valid until they expire (≤ 15 min).
2. **Session families.** Each login opens a family (`familyId` = the first `jti`); each rotation adds a row pointing at the same family. Revoking a family kills that device only.

Access tokens are stateless and are **not** checked against the session store — that is the deliberate trade-off for the short lifetime.

## How to Extend

- To add OAuth/social login: add methods to `AuthService` that end in `openSession()`, so the session/rotation model stays uniform
- To send a code for another purpose (the email verification, the email change): add its purpose to `AUTH_CODE_PURPOSES` and reuse `authcodes`, the digests of `authCodes.ts` and, where the answer must not tell addresses apart, `holdBrakes`
- To put the captcha on another route: add its action to `CaptchaAction` and mount `requireCaptcha(action, verifier)` after `validate()`
- To make access tokens revocable immediately: check the session store in `authMiddleware` — accept the per-request read it costs
- Always keep auth routes **before** the global `authMiddleware` in `src/app.ts`
- Any new claim added to the access token (like `timezone`) is stale for up to `JWT_EXPIRATION`; consumers need a DB fallback, as `StatsController` and `BudgetController` do
