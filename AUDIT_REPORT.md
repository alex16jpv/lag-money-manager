# Technical Audit Report — lag-money-manager

**Date:** 2026-03-29  
**Auditor:** Senior Software Engineer (automated)  
**Scope:** Full codebase scan including domain, application, shared, config, tests, infrastructure, and documentation.

---

## 1. Critical Issues

### 1.1 Non-atomic balance adjustments on transactions (DATA LOSS RISK)

- **File:** `src/app/services/TransactionService.ts` (lines 35–86)
- **Severity:** Critical
- **Description:** `createTransaction`, `updateTransaction`, and `deleteTransaction` perform multi-step balance adjustments (debit source account, credit destination account, write transaction) as separate, independent repository calls with no database transaction wrapping. If any step fails mid-way (e.g., server crash after debiting source but before crediting destination, or DB timeout after balance adjustment but before transaction write), account balances become permanently inconsistent with transaction records.
- **Example — `updateTransaction` (lines 48–71):**
  1. Reverses old transaction balances (`adjustBalances(existing, -1)`)
  2. Applies new transaction balances (`adjustBalances(updated, 1)`)
  3. Persists the transaction update (`transactionRepo.update(id, dto)`)

  A failure at step 3 leaves balances reflecting the new transaction while the DB still holds the old transaction data.

- **Recommended fix:** Introduce a Unit of Work or database transaction wrapper. For Sequelize, use `sequelize.transaction()` and pass the transaction object through repository calls. For Mongoose, use sessions with `startSession()`/`withTransaction()`. Add a `withTransaction(callback)` method to the repository interface.

### 1.3 `GET /users` exposes all user data without authorization

- **File:** `src/app/controllers/UserController.ts` (lines 9–12), `src/app/services/UserService.ts` (lines 22–29), `src/app/routes/userRoutes.ts` (line 34)
- **Severity:** High
- **Description:** The `GET /users` endpoint returns a paginated list of **all** users in the system. It requires only JWT authentication — no admin role check. The agent-context document states all resources are "user-scoped" and users should only access their own data. While passwords are stripped via `toResponseDTO`, emails and names of all users are exposed.
- **Recommended fix:** Either remove the endpoint, restrict it to an admin role, or change it to only return the authenticated user's own profile.

### 1.4 TODO comment with commented-out code in production path

- **File:** `src/app/services/TransactionService.ts` (lines 40–43)
- **Severity:** High (violates agent-context Section 6: "Do NOT leave dead code, commented-out blocks, or TODO comments in production code")
- **Description:** Lines 40–43 contain a TODO block and commented-out budget logic. Per project conventions this is forbidden.
- **Recommended fix:** Remove the TODO and commented-out block. Track budget feature separately in issue tracker.

---

## 5. Missing Tests

### 5.1 Repository implementations — **No tests at all**

- **Module:** All 8 repository files (4 Sequelize + 4 Mongoose)
- **Priority:** High
- **Description:** Zero test coverage for any repository implementation. These contain pagination logic, entity mapping (`toEntity`/`toJSON`), cursor-based pagination, and error handling. Bugs in entity mapping (like issue 2.1) are not caught.

### 5.2 Validation schemas — **No tests**

- **Module:** `src/app/validation/schemas.ts`
- **Priority:** High
- **Description:** No direct unit tests for Zod validation schemas. The `superRefine` logic in `createTransactionSchema` (EXPENSE requires `fromAccountId`, TRANSFER requires both, same-account check) is only partially tested via integration tests. Edge cases like max-length strings, invalid UUIDs, boundary values for amounts are not covered.

### 5.3 Validation middleware — **No tests**

- **Module:** `src/app/validation/validate.ts`
- **Priority:** Medium
- **Description:** No unit test for the `validate()` middleware factory. The error response format, unknown error fallthrough (`next(error)`), and multiple validation issue aggregation are not directly tested.

### 5.4 Auth middleware — **No dedicated unit tests**

- **Module:** `src/app/middlewares/authMiddleware.ts`
- **Priority:** Medium
- **Description:** The auth middleware is tested indirectly via integration tests, but there are no unit tests for edge cases: malformed Bearer token format, expired token, token with missing `userId` or `email` claims, multiple Authorization headers.

### 5.5 Transaction balance adjustment edge cases

- **Module:** `src/app/services/TransactionService.ts` (lines 88–131)
- **Priority:** High
- **Description:** While `TransactionService.test.ts` tests basic balance adjustments, it does **not** test:
  - Partial failure scenarios (first account update succeeds, second fails)
  - Floating-point precision issues (e.g., 0.1 + 0.2)
  - Negative balance results
  - Account not found during reversal (direction === -1, line 100–107 silently skips)

### 5.6 Controller layer — **No unit tests**

- **Module:** All 5 controller files
- **Priority:** Medium
- **Description:** Controllers have no dedicated unit tests. They are only tested indirectly through integration tests. Controller-specific behavior (pagination extraction, response status codes, body formatting) is partially covered but not isolated.

### 5.7 Configuration and startup — **No tests**

- **Modules:** `src/config/`, `src/server.ts`
- **Priority:** Low
- **Description:** No tests for database connection setup, Sequelize/Mongoose initialization failures, or `ENVIRONMENT` parsing edge cases (missing required vars, invalid DB_TYPE).

### 5.8 Factory and providers — **No tests**

- **Module:** `src/app/factories/RepositoryFactory.ts`, `src/app/factories/providers/`
- **Priority:** Medium
- **Description:** No tests for the factory/provider pattern: unregistered DB_TYPE, unregistered repository key, cache behavior, provider registration.

---

## 6. Documentation Gaps

| #   | Gap                                                                                                                             | Suggested update                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 6.1 | No ADR (Architecture Decision Record) documents exist — the `decisions/` folder only contains `_template.md`                    | Create ADRs for key decisions: dual-DB support, UUIDv7, Express 5, Zod choice       |
| 6.2 | `docs/modules/users.md` does not document that `GET /users` returns all users (security concern)                                | Update `docs/modules/users.md` with endpoint authorization matrix                   |
| 6.3 | No documentation on transaction balance adjustment logic and failure modes                                                      | Add "Balance Adjustment" section to `docs/modules/transactions.md`                  |
| 6.4 | `docs/guides/environment-vars.md` may not document `LOG_LEVEL` or `NODE_ENV`                                                    | Update `docs/guides/environment-vars.md` with full `ENVIRONMENT` schema             |
| 6.5 | No production deployment guide (HTTPS, pool config, signal handling, container health checks)                                   | Create `docs/guides/deployment.md` and add to `docs/_index.json`                    |
| 6.6 | `docs/reference/error-handling.md` does not document all error middleware branches (MongoServerError, CastError, FK constraint) | Update `docs/reference/error-handling.md` with complete error → HTTP status mapping |
| 6.7 | `docs/guides/testing.md` exists but no mention of coverage thresholds or expected coverage targets                              | Update `docs/guides/testing.md` with coverage requirements                          |
| 6.8 | OpenAPI spec in `swagger.ts` is manually maintained — no docs on keeping it in sync with Zod schemas                            | Add sync process notes to `docs/guides/contributing.md`                             |

---

## 7. Quick Wins

Sorted by effort (ascending):

| #    | Change                                                                                | Effort | Impact                                               | File(s)                                                                 |
| ---- | ------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| 7.1  | Fix `UserSeqRepository.getAll()` — add `.toJSON()` call                               | 1 min  | Prevents ORM object leaking into entity              | `src/domain/repositories/user/UserSeqRepository.ts` (line 49)           |
| 7.2  | Trim CORS origins: `.split(",").map(s => s.trim())`                                   | 1 min  | Prevents CORS failures from env var whitespace       | `src/app.ts` (line 39)                                                  |
| 7.3  | Remove TODO comment and dead code block                                               | 1 min  | Enforces project conventions                         | `src/app/services/TransactionService.ts` (lines 40–43)                  |
| 7.4  | Make `model` private in all Sequelize repositories                                    | 2 min  | Enforces encapsulation                               | 4 `*SeqRepository.ts` files (line 13 each)                              |
| 7.5  | Validate `x-request-id` format (UUID or alphanumeric, max 64 chars)                   | 5 min  | Prevents log injection                               | `src/shared/requestId.ts`                                               |
| 7.6  | Remove redundant `count()` call in Sequelize pagination — use `findAndCountAll` count | 10 min | ~50% reduction in DB reads for list endpoints        | 4 `*SeqRepository.ts` files                                             |
| 7.7  | Remove `balance` from `UpdateAccountDTO` and `updateAccountSchema`                    | 5 min  | Prevents balance manipulation bypassing transactions | `src/app/dtos/AccountDTO.ts`, `src/app/validation/schemas.ts`           |
| 7.8  | Add graceful shutdown handlers in `server.ts`                                         | 10 min | Prevents connection leaks on termination             | `src/server.ts`                                                         |
| 7.9  | Add composite `(userId, id)` indexes via migration                                    | 15 min | Faster user-scoped paginated queries                 | New migration file                                                      |
| 7.10 | Add ownership check for `fromAccountId`/`toAccountId` in `TransactionService`         | 15 min | Fixes critical IDOR vulnerability                    | `src/app/services/TransactionService.ts`                                |
| 7.11 | Restrict or remove `GET /users` endpoint                                              | 10 min | Fixes user enumeration vulnerability                 | `src/app/routes/userRoutes.ts`, `src/app/controllers/UserController.ts` |
| 7.12 | Add Pino redaction for sensitive fields                                               | 5 min  | Prevents secrets in logs                             | `src/shared/logger.ts`                                                  |

---

## Summary

| Severity                | Count |
| ----------------------- | ----- |
| Critical                | 2     |
| High                    | 4     |
| Architecture Violations | 5     |
| Performance Concerns    | 5     |
| Code Quality Issues     | 7     |
| Missing Test Areas      | 8     |
| Documentation Gaps      | 8     |
| Quick Wins              | 12    |

**Top 3 priorities:**

1. **Fix non-atomic balance adjustments** (Critical — data integrity risk)
2. **Add account ownership verification in transactions** (Critical — IDOR vulnerability)
3. **Restrict `GET /users` endpoint** (High — user data exposure)
