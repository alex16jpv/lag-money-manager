# API Audit Report

**Date:** March 29, 2026  
**Project:** lag-money-manager  
**Stack:** Node.js + Express 5 + TypeScript 6 + Zod 4 + Mongoose 9 / Sequelize 6 + MySQL + JWT + Pino logger

---

## Executive Summary

The project demonstrates solid architectural foundations: a clean layered structure (controllers → services → repositories → models), a well-implemented repository pattern with factory-based database provider abstraction, Zod input validation on all endpoints, and comprehensive Swagger/OpenAPI documentation. The critical security issues from Phase 1 have been addressed: user-scoped data access with ownership checks is enforced across all endpoints, CORS is restricted to configured origins, passwords are stripped from all User API responses, and `@types/uuid` has been moved to `devDependencies`. Remaining critical issue: balance-modifying transaction operations lack database-level atomicity. The test suite (142 total test cases) covers both happy paths and authorization enforcement.

---

## Critical Issues ⛔

1. **No Transaction Atomicity for Balance Updates**  
   `TransactionService.ts` lines 78–136 (`applyBalanceChanges`) and lines 138–175 (`reverseBalanceChanges`) perform multiple sequential `accountRepo.update()` calls without a database transaction wrapper. If any update fails midway (e.g., network error), account balances will be permanently inconsistent. This is especially dangerous for `TRANSFER` operations that modify two accounts.
   - File: `src/app/services/TransactionService.ts`, lines 78–175

---

## High Priority 🔴

5. **`UserService.updateUser` Mutates the Incoming DTO**  
   ~~`UserService.ts:39` mutates `dto.password` directly (`dto.password = await bcryptjs.hash(...)`) instead of creating a copy.~~  
   **Fixed** — `UserService.updateUser` now creates a copy of the DTO with the hashed password instead of mutating the original.
   - File: `src/app/services/UserService.ts`

6. **Swagger Protected Endpoints Missing `security` Annotation**  
   Only `authRoutes.ts` explicitly declares `security: []` to opt out of the global bearer auth. All other route files (`userRoutes.ts`, `accountRoutes.ts`, `categoryRoutes.ts`, `transactionRoutes.ts`) rely on the global `security` from the swagger config but do **not** include `security` in their individual operation annotations. While the global default applies, explicitly documenting `security: [{ bearerAuth: [] }]` per endpoint is best practice for clarity and prevents accidental removal of the global default from silently breaking documentation.
   - Files: `src/app/routes/userRoutes.ts`, `src/app/routes/accountRoutes.ts`, `src/app/routes/categoryRoutes.ts`, `src/app/routes/transactionRoutes.ts`

7. **`connectMongo()` Called With Fire-and-Forget `.catch()`**  
   In `mongoProvider.ts:16`, `connectMongo()` is called without `await`. The MongoDB connection races with the first request. If the connection fails, `process.exit(1)` is called, but if a request arrives before the connection is established, it will fail unpredictably.
   - File: `src/app/factories/providers/mongoProvider.ts`, line 16

8. **No Pagination on List Endpoints**  
   All `getAll()` methods return every record in the database with no pagination, limit, or cursor. As data grows, these endpoints will cause memory exhaustion and slow responses.
   - Files: all repositories' `getAll()` methods, all `*Service.getAll*()` methods

---

## Medium Priority 🟡

11. **`UserController` and `AuthController` Create Service Instances at Module Level**  
    Services are instantiated at the module top level (e.g., `AuthController.ts:4`, `UserController.ts:5`). This means the `RepositoryFactory` is invoked at `require()` time, making it impossible to swap repositories in tests without `jest.mock` at the module level. Constructor-based dependency injection into controllers would be cleaner.
    - Files: `src/app/controllers/AuthController.ts:4`, `src/app/controllers/UserController.ts:5`, `src/app/controllers/AccountController.ts:5`, `src/app/controllers/CategoryController.ts:6`, `src/app/controllers/TransactionController.ts:5`

12. **Duplicate Validation in Domain Entities and Zod Schemas**  
    Validation rules (e.g., required fields, enum constraints, positive amount) are duplicated between Zod schemas (`schemas.ts`) and domain entity `validate()` methods (`Transaction.ts`, `Account.ts`, etc.). This creates maintenance burden and inconsistency risk. Consider making domain entity validation the authoritative source, or removing it and relying solely on Zod at the boundary.
    - Files: `src/app/validation/schemas.ts` vs. `src/domain/entities/*.ts`

13. **Unsafe Double-Cast Pattern in `TransactionMongoRepository`**  
    `TransactionMongoRepository.ts` uses `doc as unknown as Record<string, unknown>` in 4 places (lines ~29, 35, 42, 55). This defeats TypeScript's type safety. A typed Mongoose `lean()` result or a properly typed toEntity mapper would be safer.
    - File: `src/domain/repositories/transaction/TransactionMongoRepository.ts`

14. **Unsafe `as Account["type"]` Casts in `AccountMongoRepository`**  
    `AccountMongoRepository.ts` casts `doc.type as Account["type"]` in 4 places. If the MongoDB document contains an invalid type string, this cast will hide the error at compile time, potentially causing runtime issues.
    - File: `src/domain/repositories/account/AccountMongoRepository.ts`

15. **No Database Indexes for Frequently Queried Fields**  
    The Mongoose schemas only define a `unique` index on `UserMongoModel.email`. There are no indexes on `Account.userId`, `Transaction.userId`, `Transaction.fromAccountId`, `Transaction.toAccountId`, or `Transaction.categoryId`. As the dataset grows, lookups will degrade to full collection scans.
    - Files: `src/domain/models/mongoose/AccountMongoModel.ts`, `src/domain/models/mongoose/TransactionMongoModel.ts`

16. **`ENVIRONMENT` Constant Has Conditional Type — Requires Unsafe Casts**  
    `constants.ts:67–69` returns either `seqEnvSchema` or `mongoEnvSchema` parse result depending on `DB_TYPE`. Subsequent consumers must cast `ENVIRONMENT` (e.g., `mongoConnection.ts:6`: `(ENVIRONMENT as { MONGO_URI: string }).MONGO_URI`). A discriminated union or separate accessor functions would be type-safe.
    - Files: `src/shared/constants.ts:67–69`, `src/config/mongoConnection.ts:6`, `src/config/sequelizeConnection.ts:4–9`

17. **Hardcoded JWT Expiration**  
    `AuthService.ts:44` hardcodes `{ expiresIn: "24h" }`. This should be an environment variable to allow configuration without code changes.
    - File: `src/app/services/AuthService.ts`, line 44

18. **Hardcoded bcrypt Salt Rounds**  
    Both `AuthService.ts:14` and `UserService.ts:28` hardcode `bcryptjs.hash(_, 12)`. The salt round count should be a constant or environment variable.
    - Files: `src/app/services/AuthService.ts:14`, `src/app/services/UserService.ts:28`

19. **No `LOG_LEVEL` in Environment Validation Schema**  
    `logger.ts:4` reads `process.env.LOG_LEVEL` directly, bypassing the Zod-validated `ENVIRONMENT` object. This inconsistency means `LOG_LEVEL` is not validated at startup.
    - File: `src/shared/logger.ts`, line 4

20. **No `NODE_ENV` in Environment Validation Schema**  
    `app.ts:19` and `logger.ts:5` read `process.env.NODE_ENV` directly, not through the validated `ENVIRONMENT` object.
    - Files: `src/app.ts:19`, `src/shared/logger.ts:5`

---

## Low Priority 🟢

21. **`CategoryModel.associate()` Is Empty**  
    `CategoryModel.ts:9` defines an empty `static associate()` method. It should either define relationships (e.g., `hasMany` on `Transaction`) or be removed to avoid confusion.
    - File: `src/domain/models/sequelize/CategoryModel.ts`, line 9

22. **`CategoryService` Constructor Has Redundant Assignment**  
    ~~`CategoryService.ts:9` explicitly assigns `this.repo = repo` after using `private repo` in the constructor parameter, which already performs the assignment. The explicit line is redundant.~~  
    **Fixed** — Redundant assignment removed during Phase 1 refactor.
    - File: `src/app/services/CategoryService.ts`

23. **`AccountService.getAllAccounts()` Maps to Entity but `TransactionService.getAllTransactions()` Does Not**  
    `AccountService.ts:10` wraps results in `new Account(account)`, while `TransactionService.ts:18` returns raw repository results. Inconsistent entity mapping across services could lead to subtle bugs.
    - Files: `src/app/services/AccountService.ts:10`, `src/app/services/TransactionService.ts:18`

24. **Commented-Out Code in `sequelize/index.ts`**  
    `src/domain/models/sequelize/index.ts:23` has `// sequelize.sync();` commented out. This dead code should be removed.
    - File: `src/domain/models/sequelize/index.ts`, line 23

25. **Tags Stored as Comma-Separated String**  
    Transaction tags are modeled as a single `string` field. For queryability (e.g., "find all transactions tagged 'food'"), a normalized many-to-many relationship or an array type would be better.
    - Files: `src/domain/entities/Transaction.ts`, `src/domain/models/mongoose/TransactionMongoModel.ts`, `src/domain/models/sequelize/TransactionModel.ts`

26. **Missing `eslint-plugin-import` or `eslint-plugin-simple-import-sort`**  
    Import ordering is consistent in the project but not enforced by any ESLint rule. Adding an import sorting plugin would prevent style drift.

27. **`explicit-function-return-type` ESLint Rule Disabled**  
    `eslint.config.mjs` disables `@typescript-eslint/explicit-function-return-type`. Many exported functions lack explicit return types (e.g., Sequelize model factories, `loadSequelizeModels`). Enabling this rule would improve code documentation.
    - File: `eslint.config.mjs`, line 18

---

## Section Reports

### 1. Project Structure & Architecture

**Rating: Good**

The project follows a well-organized layered architecture:

```
src/
├── app/           ← Application layer (controllers, services, routes, DTOs, validation, middleware)
├── config/        ← Infrastructure configuration (DB connections, Swagger)
├── domain/        ← Domain layer (entities, repositories interfaces & implementations, models)
├── shared/        ← Cross-cutting concerns (errors, logger, constants, middleware)
└── __tests__/     ← Mirrors the application structure
```

**Strengths:**

- Clear separation of concerns across layers
- Controllers are thin — they delegate to services
- Services contain business logic and use repository interfaces (not concrete implementations)
- Repository pattern properly abstracts data access
- Factory pattern (`RepositoryFactory`) with pluggable providers enables swapping databases via a single env var
- Domain entities encapsulate validation logic

**Issues:**

- Module-level service instantiation in controllers tightly couples initialization order and complicates testing (see issue #11)
- No dependency injection container — while not strictly necessary at this scale, the manual wiring in `RepositoryFactory` is a good start
- No circular dependencies detected
- DTOs are defined and used at the service-to-controller boundary (e.g., `UserService` now returns `UserResponseDTO` to strip passwords)

### 2. Database Abstraction

**Status: Present ✅ — Well Implemented**

The project has a strong database abstraction layer:

- **`IRepository<T>`** generic interface defines the contract (`getById`, `getAll`, `create`, `update`, `delete`)
- **Entity-specific interfaces** extend it (e.g., `IUserRepository` adds `getByEmail`)
- **Two complete implementations** exist: MongoDB (Mongoose) and MySQL (Sequelize)
- **`RepositoryFactory`** with provider registration pattern allows swapping databases by changing `DB_TYPE` env var
- Services depend only on interfaces, never on concrete repositories

**Issues:**

- MongoDB repositories use unsafe type casts instead of proper typed mappers (issue #13, #14)
- No UnitOfWork / transaction support in the IRepository interface — needed for atomic multi-entity operations (issue #2)
- The `IRepository.update()` returns `Promise<T>` but a not-found case throws from the repository instead of returning `null` — this mixes domain/infrastructure concerns

### 3. Swagger / API Documentation

**Status: Present ✅**

**Setup:**

- `swagger-jsdoc` v6.2.8 + `swagger-ui-express` v5.0.1
- OpenAPI 3.0.3 specification
- JSDoc annotations in each route file
- Available at `/api-docs`

**Quality Assessment:**

- All 16 endpoints are documented with `@openapi` annotations
- Comprehensive component schemas defined for all entities, DTOs, and error responses
- Request bodies, path parameters, and response status codes are well-documented
- `bearerAuth` security scheme is defined globally with JWT bearer format
- Auth routes explicitly opt out with `security: []`
- Transaction create endpoint includes detailed description of balance behavior

**Issues:**

- Protected endpoints do not explicitly declare `security: [{ bearerAuth: [] }]` in their annotations (they rely on global default) — issue #8
- Missing `409 Conflict` response documentation for duplicate email on register/user creation
- Missing `500 Internal Server Error` response documentation on all endpoints
- The `Category` schema lacks `createdAt` and `updatedAt` fields that are present in the Mongoose model

### 4. Error Handling

**Rating: Good**

**Strengths:**

- Global error middleware at `src/shared/middlewares.ts` handles all error types centrally
- Custom `ApiError` class with named error types and status codes
- `DomainValidationError` for domain-level validation failures
- Structured error responses: `{ error, message, details? }`
- Specific handlers for Sequelize unique constraint, FK constraint, MongoDB duplicate key, and Mongoose CastError
- Generic 500 fallback that sanitizes error messages (does not leak internal details)
- Logger captures unhandled errors before returning 500

**Issues:**

- No `process.on('unhandledRejection')` or `process.on('uncaughtException')` handlers in `server.ts` — if an unhandled promise rejection occurs outside Express middleware, the process may crash silently
- The error middleware types `ValidationError` and `MongoServerError` are locally defined interfaces instead of importing from Sequelize/Mongoose — they could drift from the actual error shapes
- `authMiddleware.ts` throws synchronously inside an Express middleware. While Express 5 handles this, it's better practice to use `next(error)` for consistency

### 5. Input Validation

**Rating: Excellent**

**Strengths:**

- Zod v4 is used consistently across all endpoints
- `validate()` middleware intercepts and formats Zod errors before they reach controllers
- All create/update endpoints validate `body`
- All ID-based endpoints validate `params.id` as UUID
- Transaction creation includes sophisticated cross-field validation (account requirements per transaction type, same-account detection)
- Update schemas use `.refine()` to require at least one field
- Structured error response with per-field details

**Issues:**

- The `validate` function types its parameter as `z.ZodObject<z.ZodRawShape>`, which is more restrictive than needed — some schemas use `.refine()` / `.superRefine()` which return `ZodEffects`, not `ZodObject`. This may cause type mismatches.
- `loginSchema` allows `password.min(1)` while `registerSchema` requires `password.min(8)` — intentionally different but worth a comment for clarity
- No query parameter validation for potential future filtering/pagination

### 6. Design Patterns & Best Practices

**Patterns Used:**

- ✅ Repository Pattern
- ✅ Factory Pattern (with provider registration)
- ✅ DTO Pattern (defined but inconsistently used)
- ✅ Domain Entity pattern with validation
- ✅ Middleware pattern for cross-cutting concerns

**SOLID Violations:**

- **SRP (minor):** `TransactionService` handles both transaction CRUD and account balance management. The balance logic could be extracted to a domain service.
- **DIP (minor):** Controllers instantiate services at module level with concrete factory, not via injection.

**DRY Violations:**

- Validation rules duplicated between Zod schemas and domain entity `validate()` methods (issue #12)
- User-to-entity mapping code repeated 5 times in `UserMongoRepository` — could use a private `toEntity()` method (like `TransactionMongoRepository` does)
- Account-to-entity mapping code repeated 5 times in `AccountMongoRepository`

**Anti-Patterns:**

- Module-level side effects: service instantiation (controllers) and DB provider registration (factory) happen at import time
- ~~DTO mutation: `UserService.updateUser` mutates the incoming DTO (issue #7)~~ **Fixed** — `updateUser` now creates a copy instead of mutating

**Best Practices Observed:**

- ✅ async/await used consistently (only one `.catch()` in the entire codebase, for the Mongo connection — issue #9)
- ✅ No mixing of `.then()` / `.catch()` with `async/await`
- ✅ Constants defined centrally (`shared/constants.ts`) — no magic strings
- ✅ ACCOUNT_TYPES and TRANSACTION_TYPES are typed enums using `as const`

### 7. Security

**Strengths:**

- ✅ Helmet middleware enabled for security headers (`app.ts:30`)
- ✅ Rate limiting configured (100 requests per 15 minutes) (`app.ts:33–42`)
- ✅ JSON body size limited to 10KB (`app.ts:43`)
- ✅ JWT-based authentication with proper verification
- ✅ Passwords hashed with bcryptjs (12 rounds)
- ✅ Auth middleware applied as route-level guard for all protected routes
- ✅ No hardcoded secrets — JWT_SECRET loaded from env
- ✅ `.env` in `.gitignore`
- ✅ `.env.example` exists with placeholder values
- ✅ HTTPS enforcement in production via redirect (`app.ts:19–27`)
- ✅ UUIDv7 used for IDs (not auto-incrementing integers)
- ✅ Zod validates all input at the boundary

**Issues:**

- No CSRF protection (may not apply if purely API-based with Bearer tokens)
- No request ID / correlation ID for tracing (useful for security auditing)
- JWT token has no refresh mechanism — 24h tokens mean long exposure windows
- No account lockout after failed login attempts (rate limiting mitigates partially)

### 8. TypeScript Quality

**Rating: Good**

**Strengths:**

- ✅ `strict: true` enabled in `tsconfig.json`
- ✅ `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` all enabled
- ✅ No `any` types found across the entire source codebase
- ✅ Interfaces defined for all DTOs, entity props, and repository contracts
- ✅ Mongoose document interfaces properly typed
- ✅ Generic `IRepository<T>` provides strong type contracts
- ✅ ESLint warns on `no-explicit-any` and `no-non-null-assertion`
- ✅ `forceConsistentCasingInFileNames: true`

**Issues:**

- Several uses of `as unknown as T` double-cast pattern in Mongo repositories (issues #13, #14) — defeats type safety
- `ENVIRONMENT` constant has a conditional type that forces consumers to cast (issue #16)
- `explicit-function-return-type` rule is disabled — many factory/init functions lack explicit return types (issue #27)
- Non-null assertions (`!`) used in entity constructors (e.g., `this.id = id!`, `this.createdAt = createdAt!`) — if called before persistence, these will be `undefined` at runtime despite the type saying otherwise
- `noUncheckedIndexedAccess` is not enabled — accessing array/object indexes returns `T` instead of `T | undefined`

### 9. Dependencies Audit

#### To Update:

| Package         | Current Version | Recommended Action | Reason                                                                                         |
| --------------- | --------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `sequelize`     | `^6.37.5`       | Update to v7       | Sequelize 6 is entering maintenance mode; v7 has better TypeScript support and modern features |
| `swagger-jsdoc` | `^6.2.8`        | Update to v7       | v7 supports OpenAPI 3.1 and has improved TypeScript types                                      |

#### To Add:

| Package                                                      | Reason                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `compression`                                                | Gzip response compression for production API performance |
| `eslint-plugin-import` or `eslint-plugin-simple-import-sort` | Enforce consistent import ordering                       |

**Notes:**

- All `devDependencies` are correctly separated (including `@types/uuid`)
- `pino-pretty` is correctly in `devDependencies` (used only in development via transport config)
- No known security vulnerabilities flagged in the declared version ranges (based on package names and versions as of March 2026)

### 10. Environment & Configuration

**Rating: Good**

**Strengths:**

- ✅ `.env.example` file exists with all required variables documented
- ✅ `dotenv/config` imported at the top of `server.ts`
- ✅ Zod-based environment validation at startup (`shared/constants.ts`) — fails fast with descriptive errors
- ✅ Configuration is centralized in `shared/constants.ts` and `config/` directory
- ✅ Docker Compose uses env vars from `.env` (not hardcoded)
- ✅ `.env` is in `.gitignore`
- ✅ DB connection config is centralized (`database.js`, `mongoConnection.ts`, `sequelizeConnection.ts`)

**Issues:**

- `LOG_LEVEL` and `NODE_ENV` are read directly from `process.env`, bypassing Zod validation (issues #19, #20)
- JWT expiration (`24h`) is hardcoded, not configurable via env (issue #17)
- bcrypt salt rounds (`12`) are hardcoded, not configurable via env (issue #18)
- The `database.js` Sequelize CLI config file duplicates env var reads that are already in `sequelizeConnection.ts` — this is unavoidable given Sequelize CLI's requirements but worth noting
- The `.env.example` includes `MONGO_USERNAME`, `MONGO_PASSWORD`, and `MONGO_DATABASE` which are only used by `docker-compose.yml` but not in the Zod schema — could cause confusion

### 11. Code Quality & Clean Code

**Rating: Good**

**Strengths:**

- Consistent code style enforced by ESLint + Prettier
- Short, focused functions — no function exceeds ~40 lines (except `TransactionService` balance methods)
- Clear naming conventions: files, classes, and methods are descriptively named
- No dead code blocks (except one commented `sequelize.sync()`)
- Consistent use of `async/await`
- Domain entities are anemic but appropriate for this project's complexity

**Issues:**

- `TransactionService.applyBalanceChanges()` (lines 78–136) and `reverseBalanceChanges()` (lines 138–175) are mirror images of each other with inverted operations — this duplication could be consolidated into a single method with a `direction` parameter
- One commented-out block in `sequelize/index.ts` (issue #24)
- One commented-out TODO block in `TransactionService.ts:43–46` for budget feature — acceptable but should be tracked in an issue tracker
- File `src/domain/models/sequelize/models.ts` re-exports default exports with different names (`User` instead of `UserModel`) which could be confusing
- ~~Redundant `this.repo = repo` in `CategoryService` constructor (issue #22)~~ **Fixed** in Phase 1

### 12. Testing

**Rating: Good**

**Test Suite Summary:**

- **Total test files:** 11
- **Total test cases:** 142
- **Frameworks:** Jest 30 + ts-jest + Supertest

**Coverage by Layer:**
| Layer | Files | Tests | Quality |
|---|---|---|---|
| Domain Entities | 4 | 32 | Good — validates construction and validation rules |
| Services | 5 | 54 | Good — covers happy paths, validation, and key error paths |
| Middleware | 1 | 9 | Good — covers all error mapping branches |
| Integration (API) | 1 | 44 | Good — full HTTP flow with mocked repositories |

**Strengths:**

- ✅ Tests mirror the source structure
- ✅ Service tests use properly typed mocks (`jest.Mocked<IRepository>`)
- ✅ Integration tests use `supertest` for real HTTP testing
- ✅ Good isolation — repositories mocked in service tests, services mocked in integration tests
- ✅ No `any` types in test files
- ✅ `TransactionService` tests thoroughly cover balance apply/reverse logic across all transaction types

**Missing Test Scenarios (by priority):**

**High Priority:**

- ~~No tests for authorization/ownership checks (because the feature itself is missing)~~ **Partially addressed** — Phase 1 added ownership enforcement and corresponding tests for all services
- No tests for repository failure propagation (what happens when `repo.create()` rejects?)
- No tests for concurrent balance modifications / race conditions
- No tests for expired/malformed JWT scenarios beyond basic `authMiddleware` unit

**Medium Priority:**

- `UserService` update-not-found and delete-not-found not tested
- `AccountService` update-not-found and delete-not-found not tested
- `CategoryService` update-not-found and delete-not-found not tested
- No test for `TransactionService.updateTransaction` when type changes (e.g., expense → transfer)
- No test for 500-level error responses at the API layer

**Low Priority:**

- No edge case tests for whitespace-only input strings
- No tests for invalid date strings in transaction creation
- No tests for email case sensitivity/normalization
- No e2e tests against a real database

---

## Recommended Action Plan

### Phase 2 — High Priority Fixes

5. **Add database transaction support** — Wrap `TransactionService.createTransaction`, `updateTransaction`, and `deleteTransaction` in database-level transactions (Sequelize `transaction`, Mongoose `session`). Extend `IRepository` or add a `UnitOfWork` interface.
6. **Await MongoDB connection** before accepting requests — Change `mongoProvider.ts` to `await connectMongo()` or implement a health check / readiness probe.
7. **Add `process.on('unhandledRejection')` handler** in `server.ts`.
8. **Add pagination** to all `getAll` endpoints (limit, offset, cursor).

### Phase 3 — Medium Priority Improvements

9. **Consolidate validation** — Choose either Zod (at HTTP boundary) or domain entity `validate()` as the single source of truth.
10. **Extract JWT expiration and bcrypt rounds** to environment variables.
11. **Add `LOG_LEVEL` and `NODE_ENV`** to the Zod environment schema.
12. **Fix unsafe type casts** in Mongo repositories — use properly typed mappers.
13. **Add database indexes** for `userId`, `fromAccountId`, `toAccountId`, `categoryId` on Mongo schemas.
14. **Add missing tests** for error propagation, not-found on update/delete, and JWT edge cases.

### Phase 4 — Low Priority Polish

15. **Remove dead code** (commented `sequelize.sync()`, empty `associate()`).
16. **Consolidate `applyBalanceChanges` / `reverseBalanceChanges`** into a single parameterized method.
17. **Enable `explicit-function-return-type`** ESLint rule.
18. **Add import ordering ESLint plugin**.
19. **Add response compression** middleware.
20. **Consider adding request correlation IDs** for tracing.

---

## Changelog

### 2026-03-29 - Phase 1 Fix Session

**Fixed points:**

- **Issue #1 (Critical) — Broken Access Control**: Implemented user-scoped data access across all endpoints. All controllers now extract `req.user.userId` from the JWT token and pass it to services. Services filter list queries by userId and verify resource ownership on getById/update/delete operations. Repository interfaces (`IAccountRepository`, `ICategoryRepository`, `ITransactionRepository`) now include `getAllByUserId(userId)` methods implemented in both Mongo and Sequelize repositories. Category entity was extended with a `userId` field to enable per-user categories. `userId` was removed from request body Zod schemas for account and transaction create/update operations — it is now derived exclusively from the auth token. User endpoints restrict access to the authenticated user's own data only.
- **Issue #3 (Critical) — `@types/uuid` in Production Dependencies**: Moved `@types/uuid` from `dependencies` to `devDependencies` in `package.json`.
- **Issue #4 (Critical) — CORS Fully Open**: CORS is now restricted to origins specified via the `CORS_ORIGIN` environment variable (comma-separated). Added `CORS_ORIGIN` to the Zod-validated base environment schema and `.env.example`.
- **Issues #5, #6 (High) — Password Exposed in User Responses**: Added `toResponseDTO()` method to `UserService` that strips the password field. All `UserService` methods (`getAllUsers`, `getUserById`, `createUser`, `updateUser`) now return `UserResponseDTO` instead of `User`.
- **Issue #7 (High) — DTO Mutation in UserService.updateUser**: `updateUser` now creates a copy of the DTO with the hashed password instead of mutating the incoming DTO directly.
- **Issue #22 (Low) — Redundant CategoryService Assignment**: Removed the redundant `this.repo = repo` explicit assignment during the CategoryService refactor.

**Files modified:**

- `src/domain/entities/Category.ts`: Added `userId` field to entity and props, added userId validation
- `src/domain/models/mongoose/CategoryMongoModel.ts`: Added `userId` to document interface and schema
- `src/domain/models/sequelize/CategoryModel.ts`: Added `userId` column
- `src/app/dtos/CategoryDTO.ts`: Added `userId` to `CreateCategoryDTO`
- `src/app/dtos/AccountDTO.ts`: Removed `userId` from `UpdateAccountDTO`
- `src/app/dtos/TransactionDTO.ts`: Removed `userId` from `UpdateTransactionDTO`
- `src/domain/repositories/account/IAccountRepository.ts`: Extended with `getAllByUserId`
- `src/domain/repositories/category/ICategoryRepository.ts`: Extended with `getAllByUserId`
- `src/domain/repositories/transaction/ITransactionRepository.ts`: Extended with `getAllByUserId`
- `src/domain/repositories/account/AccountMongoRepository.ts`: Implemented `getAllByUserId`
- `src/domain/repositories/account/AccountSeqRepository.ts`: Implemented `getAllByUserId`
- `src/domain/repositories/category/CategoryMongoRepository.ts`: Updated mapping to include userId, implemented `getAllByUserId`
- `src/domain/repositories/category/CategorySeqRepository.ts`: Implemented `getAllByUserId`
- `src/domain/repositories/transaction/TransactionMongoRepository.ts`: Implemented `getAllByUserId`
- `src/domain/repositories/transaction/TransactionSeqRepository.ts`: Implemented `getAllByUserId`
- `src/app/services/AccountService.ts`: Added userId param for filtering and ownership checks
- `src/app/services/CategoryService.ts`: Added userId param, removed redundant constructor assignment
- `src/app/services/TransactionService.ts`: Added userId param for filtering and ownership checks
- `src/app/services/UserService.ts`: Added `toResponseDTO()`, ownership checks, no longer mutates DTO
- `src/app/controllers/AccountController.ts`: Extracts userId from token, injects into service/DTO
- `src/app/controllers/CategoryController.ts`: Extracts userId from token, injects into service/DTO
- `src/app/controllers/TransactionController.ts`: Extracts userId from token, injects into service/DTO
- `src/app/controllers/UserController.ts`: Extracts userId from token, enforces self-access
- `src/app/validation/schemas.ts`: Removed `userId` from account and transaction body schemas
- `src/config/swagger.ts`: Removed `userId` from create/update request body schemas, added userId to Category schema
- `src/shared/errors.ts`: Added `Forbidden: 403` to ApiError error map
- `src/shared/constants.ts`: Added `CORS_ORIGIN` to base env schema
- `src/app.ts`: CORS now uses `ENVIRONMENT.CORS_ORIGIN` with origin restriction
- `package.json`: Moved `@types/uuid` from `dependencies` to `devDependencies`
- `.env.example`: Added `CORS_ORIGIN` variable
- `src/database/migrations/20260329000001-add-userId-to-categories.js`: New migration to add userId to Categories table
- `src/__tests__/entities/Category.test.ts`: Updated for userId field
- `src/__tests__/services/AccountService.test.ts`: Updated for userId params and `getAllByUserId`
- `src/__tests__/services/CategoryService.test.ts`: Updated for userId params and `getAllByUserId`
- `src/__tests__/services/TransactionService.test.ts`: Updated for userId params and `getAllByUserId`
- `src/__tests__/services/UserService.test.ts`: Updated for ownership checks and password stripping
- `src/__tests__/integration/api.test.ts`: Updated mocks, test data, and assertions for all changes

**Dependencies added:**

- None (no new packages required)
