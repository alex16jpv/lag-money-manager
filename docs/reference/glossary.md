# Glossary

**Account**
A financial account belonging to a user. Has a name, type (CASH, ACCOUNT, CARD, etc.), and a balance. Balances are modified automatically by the Transactions module.

**Account Type**
Classification of a financial account. Defined in `ACCOUNT_TYPES` constant. Values: CASH, ACCOUNT, CARD, DEBIT_CARD, SAVINGS, INVESTMENT, OVERDRAFT, LOAN, OTHER.

**ADJUSTMENT**
Transaction type used to reconcile a stored balance against reality. Excluded from statistics and budgets, and carries no category.

**ApiError**
The primary error class for expected/handled error conditions. Wraps an HTTP status code, a message, an optional machine-readable `code`, and optional `details`. Defined in `src/shared/errors.ts`.

**Archive**
Hiding an account, category or budget without removing it: `archivedAt` is stamped with a date and the default queries filter on `archivedAt: null`. Archived records are listable with `?includeArchived=true`. Accounts and categories have a `POST /{id}/restore` endpoint; budgets do not — recovering one means creating a new budget. Distinct from **soft delete**, which uses `deletedAt`.

**Auth Middleware**
Express middleware that verifies JWT tokens (HS256, algorithm pinned) on protected routes. Extracts `userId`, `email` and `timezone` from the token and attaches them to `req.user`. Defined in `src/app/middlewares/authMiddleware.ts`.

**Balance Adjustment**
The process of updating account balances when transactions are created, updated, or deleted. Handled by `TransactionService.adjustBalances()`, always inside a **Unit of Work** so the ledger and the balances commit together. Applies the delta with an atomic `$inc`; if the `$inc` matches no account the whole transaction aborts rather than silently desyncing the balance.

**Cents (integer cents)**
How money is stored. Amounts and balances are persisted as integer cents (`balance`, `openingBalance`, `amount`) and exposed to the API as decimals; `toCents()`/`fromCents()` in `src/shared/money.ts` convert at the repository boundary. Integers keep `$inc` exact — floats accumulate rounding error. `MAX_AMOUNT` (1,000,000,000) caps a single amount so accumulated balances stay far from the limit of exact integer arithmetic in JavaScript.

**Category**
A user-defined label for organizing transactions (e.g., "Food", "Transport", "Salary"). User-scoped — each user has their own categories.

**Controller**
A class with static methods that handle HTTP requests. Extracts data from the request, delegates to a service, and formats the HTTP response. Located in `src/app/controllers/`.

**Currency (mono-currency mode)**
Each user has one ISO 4217 `currency`. It is stamped onto accounts and budgets at creation from the owner's value, and onto a transaction from the account whose balance it moves. It can be changed only while the user has no accounts (`CURRENCY_LOCKED` otherwise), and a transfer between accounts of different currencies is rejected with `CURRENCY_MISMATCH`. Multi-currency is a future feature; until then amounts are 2-decimal for every currency. Default: `COP` (`src/shared/currency.ts`).

**Cursor-based Pagination**
Pagination using the last item's ID as a cursor for the next page. Works because UUID v7 ids sort chronologically. More efficient than offset for large datasets. Supported alongside offset pagination in all list endpoints.

**DB_TYPE**
Environment variable naming the database backend. `MONGO` is the only supported value; the variable survives as the provider-registry key rather than as a real choice. See ADR-001.

**Domain Entity**
A plain TypeScript class representing a business object (User, Account, Category, Transaction). Framework-agnostic — no ORM/ODM dependencies. Located in `src/domain/entities/`.

**DomainValidationError**
Error class for domain-level validation failures within entities, carrying the offending `field` and an optional `code`. Defined in `src/domain/errors.ts`. Surfaces as a 400 with `code: "VALIDATION"` unless the throw site set a more specific one.

**DTO (Data Transfer Object)**
TypeScript interface defining the shape of data flowing into services. Separates the API boundary from the domain layer. Located in `src/app/dtos/`.

**ENVIRONMENT**
Validated environment variable object created by parsing `process.env` through a Zod schema. Defined in `src/shared/constants.ts`. Fail-fast: the app won't start if required variables are missing.

**Error Code**
The stable, machine-readable `code` field on an error response (`DUPLICATE`, `INVALID_ID`, `DB_UNAVAILABLE`, `CURRENCY_MISMATCH`, `IDEMPOTENCY_PAYLOAD_MISMATCH`, ...). Clients branch on `code`; `message` is human-facing prose and may be reworded without notice. See `error-handling.md`.

**Error Middleware**
Global Express error handler at the end of the middleware chain. Catches all errors, identifies their type, and returns structured JSON responses. Defined in `src/shared/middlewares.ts`.

**EXPENSE**
Transaction type where money flows out of a source account (`fromAccountId`). Decreases the account balance.

**Factory (Repository Factory)**
Centralized class that creates and caches repository instances, resolved through the provider registered for `DB_TYPE`. Defined in `src/app/factories/RepositoryFactory.ts`.

**Gateway Secret**
Shared secret expected in the `x-api-secret` header on every request past the probe endpoints, compared timing-safely against `API_SECRET`. Optional in local development; a missing `API_SECRET` in production is treated as a misconfiguration and fails closed. Middleware in `src/app/middlewares/gatewaySecretMiddleware.ts`.

**Idempotency-Key**
Optional client-supplied header on `POST /transactions` and `POST /transactions/quick` (1–200 chars of `[A-Za-z0-9_-]`). The key, its scope and a hash of the request payload are recorded in the same MongoDB transaction as the created transaction, so a retry replays the original response instead of double-charging an account. Reusing a key with a different payload returns 422 `IDEMPOTENCY_PAYLOAD_MISMATCH`; reusing one whose transaction was deleted returns 409 `IDEMPOTENCY_ORIGINAL_DELETED`. Keys expire 24 hours after creation via a TTL index.

**INCOME**
Transaction type where money flows into a destination account (`toAccountId`). Increases the account balance.

**Index Sync**
The deploy step that pushes the indexes declared on the Mongoose schemas to the database (`npm run db:sync-indexes`, `scripts/sync-indexes.ts`). Mongoose's `autoIndex` is disabled in production, so indexes are built here rather than on connect. There are no migrations — MongoDB is schema-on-write.

**IRepository**
Generic base interface for all repositories. Defines `getById`, `getAll`, `create`, `update`, `delete`, each accepting an optional `TxSession`. Defined in `src/domain/repositories/IRepository.ts`.

**JWT (JSON Web Token)**
Authentication mechanism used for protected routes. Issued on login, contains `userId` and `email`. Verified by the auth middleware.

**Mongoose Model**
MongoDB schema definitions using Mongoose. Located in `src/infrastructure/models/`, one file per collection (`AccountModel.ts`, `TransactionModel.ts`, ...), including infrastructure-only collections with no domain entity (`IdempotencyKeyModel`, `RateLimitModel`, `RefreshSessionModel`).

**Ownership Check**
Verification that the authenticated user owns the requested resource. Done by comparing `entity.userId` with `req.user.userId` in the service layer.

**Pagination**
System for returning large result sets in pages. Supports both offset-based (`limit`/`offset`) and cursor-based (`cursor`) pagination. Utilities in `src/shared/pagination.ts`.

**Provider**
A function that registers repository creators with the Repository Factory under a `DB_TYPE` key. Only `mongoProvider.ts` exists. Located in `src/app/factories/providers/`.

**Repository**
Data access abstraction. The interface defines the contract (`I[Entity]Repository` in `src/domain/repositories/`), and the implementation handles the MongoDB queries (`[Entity]Repository` in `src/infrastructure/repositories/`). Methods accept an optional `TxSession` so callers can enlist them in a **Unit of Work**.

**Request ID**
A UUID correlation identifier assigned to every request via the `X-Request-Id` header. A client-supplied value is honoured when it matches `^[a-zA-Z0-9\-_]{1,64}$`, otherwise one is generated; it is echoed back on the response. Used for log tracing. Middleware in `src/shared/requestId.ts`.

**Request Log**
The single structured line emitted per request when the response finishes: `method`, `path`, `status`, `durationMs`, `requestId`, plus the error `code` and `userId` when available. Level follows the status (`error`/`warn`/`info`), with the `/` and `/health/db` probes dropped to `debug` while healthy. Middleware in `src/app/middlewares/requestLogMiddleware.ts`.

**Route**
Express Router definition that maps HTTP methods/paths to validation middleware and controller methods. Located in `src/app/routes/`. Includes OpenAPI JSDoc annotations.

**Service**
Business logic layer. Receives repository interfaces via constructor injection. Performs ownership checks, data transformations, and cross-entity operations. Located in `src/app/services/`.

**Soft Delete**
Marking a record deleted with a `deletedAt` timestamp instead of removing the document; every query filters on `deletedAt: null`. Used for transactions (deleting one reverses its balance effect but keeps the row) and for users. Distinct from **Archive**, which uses `archivedAt` and is user-reversible.

**Transaction (financial)**
A financial record representing money movement. Types: INCOME, EXPENSE, TRANSFER, ADJUSTMENT. Automatically adjusts account balances on create/update/delete. Not to be confused with a database transaction — see **Unit of Work**.

**TRANSFER**
Transaction type where money moves between two accounts. Decreases `fromAccountId` balance and increases `toAccountId` balance by the same amount.

**Unit of Work**
`withTransaction(fn)` in `src/shared/unitOfWork.ts`: runs `fn` inside a MongoDB multi-document transaction, passing it a `TxSession` that every write in the callback must forward. Used so a transaction insert, its balance `$inc`s and its idempotency record commit or abort as one. Requires a **replica set** — see ADR-001. The callback can be retried on a transient write conflict, so it must be idempotent and must not perform external side effects.

**UUID v7**
Time-ordered universally unique identifier used for all entity IDs. Generated by the `uuid` package's `v7()` function in the entity constructor. Stored as the document `_id`, typed `String`.

**Validation Middleware**
Express middleware factory that validates `req.body`, `req.query`, and `req.params` against a Zod schema, then replaces `req.body`/`req.params` with the parsed values so undeclared fields cannot reach a service (mass-assignment guard). Returns 400 with `code: "VALIDATION"` and field-level details on failure. Defined in `src/app/validation/validate.ts`.

**Zod**
TypeScript-first schema validation library used for request validation and environment variable parsing. Version 4.x.
