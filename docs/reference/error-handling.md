# Error Handling Reference

## Global Error Handling Strategy

All errors in the application are handled by a single global error middleware registered at the end of the Express middleware chain in `src/app.ts`. This ensures consistent error response formatting across all endpoints.

**Error middleware location:** `src/shared/middlewares.ts`

**Flow:**

1. Any thrown error or rejected Promise in a controller/service/middleware is caught
2. The error middleware identifies the error type
3. It stashes the machine-readable code and message on `res.locals` so `requestLogMiddleware` can say _why_ the request failed in its completion line
4. A structured JSON response is sent with the appropriate HTTP status code
5. Unknown and infrastructure errors are logged with the request ID for traceability

## Rule for Clients: Branch on `code`, Never on `message`

Every error response carries an `error` name and a `message`. Responses the client is expected to react to also carry a **`code`** — a stable, machine-readable string. That is the only field with a compatibility guarantee.

```ts
// GOOD
if (body.code === "CURRENCY_MISMATCH") showCurrencyHelp();

// BAD — reworded copy silently breaks this
if (body.message.includes("different currencies")) showCurrencyHelp();
```

`message` is human-facing prose: it gets reworded, translated and shortened without notice. Status codes are too coarse to distinguish `CATEGORY_ARCHIVED` from `FUTURE_DATE` — both are 400. When a branch matters, the backend owes you a `code`; if one is missing for a case you need, add it at the throw site rather than parsing prose.

## Custom Error Classes

### `ApiError` (`src/shared/errors.ts`)

The primary error class for expected/handled error conditions in the service layer.

```typescript
class BaseError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ApiError extends BaseError {
  static errors = {
    BadRequest: 400,
    Unauthorized: 401,
    Forbidden: 403,
    NotFound: 404,
    Conflict: 409,
    UnprocessableEntity: 422,
    InternalServerError: 500,
  };

  // Stable machine-readable code; clients branch on this, never on `message`.
  code?: string;

  constructor(
    name: keyof typeof ApiError.errors,
    message?: string,
    code?: string,
    details?: unknown,
  ) {
    super(message || name, ApiError.errors[name], details);
    this.name = name + "Error";
    this.code = code;
  }
}
```

Note the argument order: **`code` comes third**, before `details`.

**Usage:**

```typescript
// No code: the status alone tells the client everything it can act on.
throw new ApiError("NotFound", "Transaction not found");
throw new ApiError("Forbidden", "Access denied");
throw new ApiError("Unauthorized", "Invalid or expired token");

// With a code: the client has to distinguish this case from its siblings.
throw new ApiError("BadRequest", "Category is archived", "CATEGORY_ARCHIVED");
throw new ApiError("Conflict", "Email is already registered", "EMAIL_TAKEN");
throw new ApiError(
  "UnprocessableEntity",
  "Idempotency-Key was already used with a different payload",
  "IDEMPOTENCY_PAYLOAD_MISMATCH",
);
```

### `DomainValidationError` (`src/domain/errors.ts`)

For domain-level validation errors within entities (raised by `assertValid()`).

```typescript
export class DomainValidationError extends Error {
  field?: string;
  // Stable machine-readable code; defaults to VALIDATION at the API boundary.
  code?: string;

  constructor(message: string, field?: string, code?: string) {
    super(message);
    this.name = "DomainValidationError";
    this.field = field;
    this.code = code;
  }
}
```

## Error Response Formats

Every response has `error` and `message`. `code` is present whenever the throw site supplied one and on every branch the middleware handles itself. `details`, when present, is **always an array of `{ field, message }`** — the Zod path and the domain path produce the same shape, so a client can render field errors with one code path.

### ApiError response (no code)

```json
{
  "error": "NotFoundError",
  "message": "Transaction not found"
}
```

`details` is omitted entirely when undefined; it is not serialized as `{}`.

### ApiError response (with code)

```json
{
  "error": "BadRequestError",
  "message": "Cannot archive the default account; set another account as default first",
  "code": "DEFAULT_ACCOUNT_ARCHIVE_BLOCKED"
}
```

### DomainValidationError response

```json
{
  "error": "ValidationError",
  "message": "date cannot be more than 24 hours in the future",
  "code": "FUTURE_DATE",
  "details": [
    {
      "field": "date",
      "message": "date cannot be more than 24 hours in the future"
    }
  ]
}
```

`code` falls back to `VALIDATION` when the throw site didn't set one.

### Zod validation error response (from validation middleware)

```json
{
  "error": "ValidationError",
  "message": "Invalid request data",
  "code": "VALIDATION",
  "details": [
    { "field": "amount", "message": "Amount must be greater than 0" },
    {
      "field": "body.fromAccountId",
      "message": "fromAccountId is required for expense transactions"
    }
  ]
}
```

This one is returned by `src/app/validation/validate.ts` directly, not by the error middleware.

### MongoDB duplicate key (code 11000)

```json
{
  "error": "ConflictError",
  "message": "Duplicate value for: email",
  "code": "DUPLICATE"
}
```

### Mongoose CastError (invalid id / type mismatch)

```json
{
  "error": "ValidationError",
  "message": "Invalid ID format",
  "code": "INVALID_ID"
}
```

### Database unavailable

Returned when the Mongo driver cannot reach the cluster — server selection timeout, network error, or a query issued before the initial connection. Retryable: the client should back off and try again rather than treat it as a bad request.

```json
{
  "error": "ServiceUnavailableError",
  "message": "Database connection unavailable, please try again later",
  "code": "DB_UNAVAILABLE"
}
```

### Rate limited

Emitted by the limiters, not by the error middleware. The MongoDB-backed `/auth` limiter (`authRateLimitMiddleware.ts`) sets a `Retry-After` header and a `code`:

```json
{
  "error": "TooManyRequests",
  "message": "Too many attempts, please try again later",
  "code": "RATE_LIMITED"
}
```

The global `express-rate-limit` limiter in `src/app.ts` returns the same `error` name with `"Too many requests, please try again later"` and **no** `code` — so treat a 429 without a code as the global limit.

### Unknown/unhandled error

```json
{
  "error": "InternalServerError",
  "message": "An unexpected error occurred",
  "code": "INTERNAL"
}
```

## HTTP Status Code Conventions

| Status | Meaning               | Used When                                                                                               |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------- |
| 200    | OK                    | Successful GET or PUT                                                                                   |
| 201    | Created               | Successful POST (resource created)                                                                      |
| 204    | No Content            | Successful DELETE                                                                                       |
| 400    | Bad Request           | Validation failure, ID mismatch, invalid format                                                         |
| 401    | Unauthorized          | Missing/invalid/expired JWT token                                                                       |
| 403    | Forbidden             | Missing or wrong `x-api-secret` gateway header                                                          |
| 404    | Not Found             | Resource doesn't exist — **also returned for a resource owned by another user**, so ids can't be probed |
| 409    | Conflict              | Duplicate unique constraint (email, etc.)                                                               |
| 422    | Unprocessable Entity  | Request understood but semantically invalid                                                             |
| 429    | Too Many Requests     | Rate limit exceeded                                                                                     |
| 500    | Internal Server Error | Unexpected/unhandled error                                                                              |
| 503    | Service Unavailable   | Database connection unavailable (retryable)                                                             |

Ownership failures return **404, not 403**. Services compare `entity.userId` against the authenticated user and throw `NotFound` — telling a caller "403" would confirm that the id exists. `ApiError("Forbidden", ...)` is reserved for the gateway-secret check.

## Error Middleware Branch Mapping

The global error middleware in `src/shared/middlewares.ts` handles errors in the following order. The **first matching branch** wins.

| #   | Error Type / Condition                            | HTTP Status                                      | `error` field             | `code`                            | `message`                                                            |
| --- | ------------------------------------------------- | ------------------------------------------------ | ------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| 1   | `ApiError` (instance check)                       | `error.statusCode` (400/401/403/404/409/422/500) | `error.name`              | `error.code` if set, else omitted | `error.message`                                                      |
| 2   | `DomainValidationError` (instance check)          | 400                                              | `ValidationError`         | `error.code ?? "VALIDATION"`      | `error.message`, echoed into `details[0]`                            |
| 3   | `MongoServerError` with `code === 11000`          | 409                                              | `ConflictError`           | `DUPLICATE`                       | `"Duplicate value for: <fields>"` from `keyValue`                    |
| 4   | `CastError` (Mongoose invalid id / type mismatch) | 400                                              | `ValidationError`         | `INVALID_ID`                      | `"Invalid ID format"`                                                |
| 5   | Mongo connection unavailable (see below)          | 503                                              | `ServiceUnavailableError` | `DB_UNAVAILABLE`                  | `"Database connection unavailable, please try again later"` (logged) |
| 6   | Any other error (fallback)                        | 500                                              | `InternalServerError`     | `INTERNAL`                        | `"An unexpected error occurred"` (logged with request ID)            |

Branch 5 matches by error name — `MongooseServerSelectionError`, `MongoServerSelectionError`, `MongoNetworkError`, `MongoNetworkTimeoutError` — plus a `MongooseError` whose message mentions `buffering timed out` or `before initial connection`.

Every branch also records the code and message on `res.locals.errorCode` / `res.locals.errorMessage`, which `requestLogMiddleware` folds into the request's completion log line. An `ApiError` thrown without a code leaves `errorCode` undefined, and the log line simply omits the field.

## Error Code Catalogue

Codes raised by the services and middleware. Anything not listed here has no `code`: the status alone carries the meaning.

| Code                              | Status | Raised when                                                                                                                                                                                                    |
| --------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION`                      | 400    | Zod schema rejection, or a domain invariant with no specific code                                                                                                                                              |
| `INVALID_ID`                      | 400    | Mongoose `CastError`                                                                                                                                                                                           |
| `INVALID_CURSOR`                  | 400    | Pagination cursor that names no row of the caller's                                                                                                                                                            |
| `FUTURE_DATE`                     | 400    | Transaction date more than 24h in the future                                                                                                                                                                   |
| `CURRENCY_MISMATCH`               | 400    | Transfer between accounts of different currencies (mono-currency mode)                                                                                                                                         |
| `CURRENCY_LOCKED`                 | 400    | Changing the user currency once accounts exist                                                                                                                                                                 |
| `CATEGORY_ARCHIVED`               | 400    | Assigning an archived category to a transaction                                                                                                                                                                |
| `CATEGORY_TYPE_MISMATCH`          | 400    | Category type doesn't match the transaction type                                                                                                                                                               |
| `CATEGORY_TYPE_LOCKED`            | 400    | Changing a category's type when it is already in use                                                                                                                                                           |
| `RESOURCE_ARCHIVED`               | 400    | Updating an archived account, category or budget                                                                                                                                                               |
| `DEFAULT_ACCOUNT_ARCHIVE_BLOCKED` | 400    | Archiving the default account before another is made default                                                                                                                                                   |
| `NO_DEFAULT_ACCOUNT`              | 400    | Quick-add with no account id and no default account set                                                                                                                                                        |
| `ACCOUNT_LIMIT_REACHED`           | 400    | Per-user account cap                                                                                                                                                                                           |
| `ACCOUNT_FIELD_NOT_FOR_TYPE`      | 400    | A debt amount on an account type that has no such field, or a type change that would orphan one                                                                                                                |
| `INCOME_ON_CARD_OR_LOAN`          | 400    | An income landing on one of the `IncomeRefusedAccountType` types the contract publishes: money arriving there is a payment, not income (an OVERDRAFT takes income: its positive balance is its ordinary state) |
| `LOAN_OVERPAID`                   | 400    | A movement, or an account write, that would leave a LOAN above zero: a loan cannot be paid more than it owes                                                                                                   |
| `AMOUNT_PRECISION`                | 400    | An amount with more decimals than the owner's currency has — none at all when it is one of the `ZeroDecimalCurrency` codes the contract publishes                                                              |
| `CATEGORY_LIMIT_REACHED`          | 400    | Per-user category cap                                                                                                                                                                                          |
| `CONTACT_LIMIT_REACHED`           | 400    | Per-user contact cap (`SharedLimits.maxContactsPerUser`)                                                                                                                                                       |
| `PARTICIPANT_LIMIT_REACHED`       | 400    | People in one shared group, the owner included (`SharedLimits.maxParticipantsPerGroup`)                                                                                                                        |
| `PARTICIPANT_ALREADY_IN_GROUP`    | 400    | Adding somebody the shared group already has                                                                                                                                                                   |
| `PARTICIPANT_NOT_IN_GROUP`        | 400    | A split, or a payer, naming somebody who is not in the shared group                                                                                                                                            |
| `PARTICIPANT_IN_USE`              | 400    | Taking somebody out of a shared group while they hold a share of an expense                                                                                                                                    |
| `SPLIT_INVALID`                   | 400    | Figures that cannot describe a split: they do not add up to the expense, the percentages are not 100, a mode is missing its figures, or a percentage group is missing its new percentages                      |
| `SHARED_EXPENSE_LINKED`           | 400    | Restating the amount, the date, the description or the payer of a shared expense that is a movement of yours: those come from the transaction                                                                  |
| `TRANSACTION_ALREADY_SHARED`      | 400    | Splitting a movement that is already an expense of a shared group                                                                                                                                              |
| `TRANSACTION_NOT_SPLITTABLE`      | 400    | Splitting a movement that is not an expense, or turning a split one into another type                                                                                                                          |
| `SETTLEMENT_OVER_PAID`            | 400    | Paying somebody back more than you owe them and more than they have paid ahead                                                                                                                                 |
| `SETTLEMENT_MOVEMENT_LOCKED`      | 400    | Editing the money of a movement a settle-up recorded, or deleting it: undo the payment instead                                                                                                                 |
| `GUEST_BLOCK_HAS_PAYMENTS`        | 400    | Deleting an expense whose block of guests has paid: the block lives in that expense and its money would have nowhere to go                                                                                     |
| `CONTACT_HAS_NO_EMAIL`            | 400    | Inviting a contact who has no email: an invitation is addressed to one                                                                                                                                         |
| `INVITATION_TO_SELF`              | 400    | Inviting a contact whose email is your own, or answering an invitation you sent                                                                                                                                |
| `INVITATION_LIMIT_REACHED`        | 400    | More invitations waiting at once than one user may have (`SharedLimits.maxPendingInvitationsPerUser`)                                                                                                          |
| `INVITATION_UNAVAILABLE`          | 400    | Answering an invitation that was withdrawn, whose group was archived or whose person was taken out, or whose 30 days passed; or leaving a group the owner already stopped sharing                              |
| `SHARED_LINE_NOT_PAID`            | 400    | Add to my ledger on a line somebody other than the owner paid, one you have no part in, or one whose part the owner has not marked paid                                                                        |
| `SHARED_LINE_IN_LEDGER`           | 400    | Add to my ledger on a line whose part is already in your ledger                                                                                                                                                |
| `BUDGET_PERIOD_OVERLAP`           | 400    | New budget period overlaps an existing one for the same scope                                                                                                                                                  |
| `IDEMPOTENCY_KEY_INVALID`         | 400    | `Idempotency-Key` outside `[A-Za-z0-9_-]{1,200}`                                                                                                                                                               |
| `MALFORMED_JSON`                  | 400    | Body that is not valid JSON (body-parser `entity.parse.failed`)                                                                                                                                                |
| `BAD_REQUEST`                     | 400    | A body-parser failure with no code of its own; also a `/sync` operation rejected with no more specific code                                                                                                    |
| `REQUEST_ABORTED`                 | 400    | The client hung up before the body arrived (body-parser `request.aborted`)                                                                                                                                     |
| `UNSUPPORTED_ENCODING`            | 415    | Body in a content encoding the server does not read                                                                                                                                                            |
| `PAYLOAD_TOO_LARGE`               | 413    | Body over the size limit                                                                                                                                                                                       |
| `CURRENT_PASSWORD_INVALID`        | 401    | Password change with the wrong current password                                                                                                                                                                |
| `REFRESH_INVALID`                 | 401    | Refresh token missing, malformed or expired                                                                                                                                                                    |
| `REFRESH_REVOKED`                 | 401    | Refresh token belongs to a revoked session                                                                                                                                                                     |
| `NOT_FOUND`                       | 404    | A `/sync` operation whose row is missing or belongs to another user                                                                                                                                            |
| `DUPLICATE`                       | 409    | MongoDB duplicate key (11000)                                                                                                                                                                                  |
| `ID_TAKEN`                        | 409    | A client-minted id that belongs to another user (the caller's own replays with 200)                                                                                                                            |
| `STALE_UPDATE`                    | 409    | `If-Match` no longer matches the stored version; `current` carries the server's copy                                                                                                                           |
| `EMAIL_TAKEN`                     | 409    | Registration with an email already in use                                                                                                                                                                      |
| `IDEMPOTENCY_ORIGINAL_DELETED`    | 409    | The transaction created with this key was deleted — retry with a new key                                                                                                                                       |
| `IDEMPOTENCY_PAYLOAD_MISMATCH`    | 422    | The key was already used with a different payload                                                                                                                                                              |
| `RATE_LIMITED`                    | 429    | `/auth` per-key rate limit exceeded                                                                                                                                                                            |
| `INTERNAL`                        | 500    | Unhandled error                                                                                                                                                                                                |
| `DB_UNAVAILABLE`                  | 503    | MongoDB unreachable — retryable                                                                                                                                                                                |

## How to Add a New Error Type

1. If it maps to an existing HTTP status code already in `ApiError.errors`, just use `ApiError`:

   ```typescript
   throw new ApiError("BadRequest", "Your specific message");
   ```

2. Add a `code` as the **third** argument whenever the client has to tell this failure apart from its siblings at the same status — a distinct message, a distinct recovery path, a distinct UI state:

   ```typescript
   throw new ApiError(
     "BadRequest",
     "Category is archived",
     "CATEGORY_ARCHIVED",
   );
   ```

   Codes are `SCREAMING_SNAKE_CASE`, stable forever once shipped, and must be added to the catalogue above and to the route's OpenAPI `description` in `src/app/routes/`.

3. If you need a new HTTP status code, add it to `ApiError.errors`:

   ```typescript
   static errors = {
     // ... existing
     PaymentRequired: 402,
   };
   ```

4. If you need a new infrastructure-specific error handler, add a new `if` block in `src/shared/middlewares.ts` **before** the 500 fallback, and call `logWhy()` so the request log carries the reason:
   ```typescript
   if (error?.name === "YourSpecificError") {
     logWhy("YOUR_CODE", error.message);
     res.status(XXX).json({ error: "...", message: "...", code: "YOUR_CODE" });
     return;
   }
   ```

## Logging Behavior on Errors

- **Every request** produces exactly one completion line from `requestLogMiddleware`, carrying `method`, `path`, `status`, `durationMs` and `requestId` — plus the `code` and `errorMessage` the error middleware stashed on `res.locals`. So even an expected 4xx leaves a traceable record of what was rejected and why. The line's level follows the status: `error` for 5xx, `warn` for 4xx, `info` otherwise.
- **Expected errors** (ApiError, DomainValidationError, duplicate key, CastError): No separate stack-trace log. The completion line above is the record.
- **Infrastructure and unexpected errors** (503, 500): Additionally logged at `error` level with the full error object and `X-Request-Id` for correlation:
  ```typescript
  logger.error(
    { err: error, requestId: req.headers["x-request-id"] },
    "Unhandled error",
  );
  ```
- **Logging library:** Pino (structured JSON in production, pretty-printed in development). `authorization`, `x-api-secret`, and any `password` or `token` field are redacted.
