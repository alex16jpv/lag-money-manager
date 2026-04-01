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
