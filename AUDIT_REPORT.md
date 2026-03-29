# API Audit Report

**Date:** March 28, 2026  
**Project:** lag-money-manager (v1.0.0)  
**Stack:** Node.js / TypeScript 5.7 / Express 4.21 / Sequelize 6.37 (MySQL) / Docker Compose

---

## Executive Summary

The project implements a layered architecture with controllers, services, and repositories — a good foundation. After the Phase 1, Phase 2, Phase 3, Phase 4, and Phase 5 fix sessions, the API now has **JWT authentication/authorization**, **zod-based input validation**, **security middleware** (CORS, Helmet, rate limiting), **structured logging** with pino, **environment variable validation at startup**, a **comprehensive test suite** (136 tests across 11 suites covering entities, services, middleware, and full HTTP integration), **OpenAPI 3.0 documentation** served at `/api-docs`, **ESLint + Prettier** for code quality enforcement, an **`asyncHandler` utility** eliminating controller try/catch boilerplate, **domain-specific validation errors** separated from HTTP-level errors, a **Sequelize CLI migration strategy** with initial migrations for all tables, a **complete Transaction feature** (entity, repository, service, controller, routes with balance management for income/expense/transfer flows), a **DTO layer** decoupling HTTP request shapes from domain entities, **`as const` type-safe constants** with derived TypeScript union types, and a **RepositoryFactory registry pattern** for extensible repository management. All Phase 1–5 action items have been resolved.

---

## Critical Issues ⛔

1. ~~**No Tests**~~ — ✅ Fixed: Jest + ts-jest configured. 136 tests across 11 suites (entity validation, service logic, error middleware, full HTTP integration with supertest).

2. ~~**No API Documentation (Swagger/OpenAPI)**~~ — ✅ Fixed: OpenAPI 3.0 spec with `swagger-jsdoc` + `swagger-ui-express` served at `/api-docs`. All endpoints documented with request/response schemas, status codes, and auth requirements.

## High Priority 🔴

_(No remaining high-priority issues.)_

## Medium Priority 🟡

5. **No `deleteAccount` Endpoint** — ~~Fixed: `deleteAccount` method and `DELETE /:id` route added.~~

6. **No `updateCategory` or `deleteCategory` Endpoints** — ~~Fixed: `updateCategory`, `deleteCategory` methods and PUT/DELETE routes added.~~

7. ~~**`sequelize.sync()` is Commented Out**~~ — Mitigated: Sequelize CLI migrations now provide proper schema management. The commented-out `sync()` is intentionally disabled in favor of migrations.

8. ~~**No Database Migration Strategy**~~ — ✅ Fixed: Sequelize CLI configured with `.sequelizerc`, `database.js` config, and initial migrations for all tables (Users, Categories, Accounts, Transactions).

## Low Priority 🟢

9. **`package-lock.json` is in `.gitignore`** — ~~Fixed: removed from `.gitignore`.~~

10. ~~**`dbModels` in `loadSequelizeModels` Uses `any`**~~ — ✅ Fixed: Replaced `any` with `Record<string, ModelStatic<Model>>`.

11. ~~**`ACCOUNT_TYPES` and `TRANSACTION_TYPES` Should Be TypeScript Enums or `as const`**~~ — ✅ Fixed: Converted to `as const` objects with exported derived union types (`AccountType`, `TransactionType`, `DbType`).

12. ~~**Missing `@types/node` in devDependencies**~~ — ✅ Fixed: Installed `@types/node` as a devDependency.

---

## Section Reports

### 1. Project Structure & Architecture

**Rating: Acceptable with issues**

The project follows a reasonably clean layered architecture:

```
routes → controllers → services → repositories → models/DB
```

**Positives:**

- Clear separation between controllers, services, and repositories
- Repository pattern with interfaces (`IUserRepository`, `IAccountRepository`, `ICategoryRepository`, `ITransactionRepository`)
- `RepositoryFactory` centralizes repository instantiation with DB-type switching
- Domain entities are separate from Sequelize models

**Issues:**

- ~~**Domain entities live in `domain/entities/` but also depend on `shared/errors.ts`**~~ — ✅ Fixed: Entities now throw `DomainValidationError` from `domain/errors.ts` instead of `ApiError`. The error middleware maps `DomainValidationError` to HTTP 400 responses.
- ~~**No Transaction entity, controller, service, or routes**~~ — ✅ Fixed: Complete Transaction feature implemented with entity, repository (interface + Sequelize), service (with account balance management for income/expense/transfer), controller, routes, Zod validation schemas, and OpenAPI documentation.
- ~~**`src/index.ts` is a scratch/test file**~~ — ✅ Removed.
- **No DTOs (Data Transfer Objects)** — ~~Controllers cast `req.body` directly to domain entities. A DTO layer would decouple HTTP request shapes from domain objects.~~ — ✅ Fixed: DTO interfaces created for all entities (`CreateUserDTO`, `UpdateUserDTO`, `UserResponseDTO`, etc.). Services accept DTOs instead of domain entities.
- ~~**No middleware layer for cross-cutting concerns**~~ — ✅ Fixed: auth middleware, validation middleware, error middleware, `asyncHandler` utility.

### 2. Database Abstraction

**Rating: Good — consistent patterns**

**Positives:**

- Repository interfaces (`IUserRepository`, `IAccountRepository`, `ICategoryRepository`, `ITransactionRepository`) abstract the data layer correctly
- `RepositoryFactory` supports swapping DB implementations via `DB_TYPE` env var
- Services depend on interfaces, not concrete implementations — good for testability and future DB swaps
- Sequelize models are separate from domain entities
- All repository implementations return domain entities (not raw Sequelize objects)
- All repository methods are implemented — no stub methods throwing errors
- Consistent `null` return pattern across all repositories for `getById`
- All repository interfaces use consistent `update(id, entity)` signature

**Issues:**

- ~~**`RepositoryFactory` constructor calls `loadSequelizeModels()` as a side effect**~~ — ✅ Fixed: Refactored to registry pattern. Model loading now happens in the constructor only for the configured DB type, and repository creators are registered lazily via `register(key, creator)` with caching via `getRepository<T>(key)`.

**To achieve full DB-swappability:**

- All repository methods must return domain entities, never ORM-specific objects
- Model associations should be configured outside the model files to avoid import order issues
- Consider using a generic `IRepository<T>` base interface to standardize CRUD signatures

### 3. Swagger / API Documentation

**Status: Implemented ✅**

OpenAPI 3.0 documentation is generated with `swagger-jsdoc` and served via `swagger-ui-express` at `/api-docs`. All endpoints are documented with JSDoc annotations on route files, including request/response schemas, status codes, and authentication requirements (Bearer JWT). Component schemas are centralized in `src/config/swagger.ts`.

### 4. Error Handling

**Rating: Good**

**Positives:**

- Custom `ApiError` class extends `BaseError` with `statusCode` and `details` — good structured approach.
  - [src/shared/errors.ts](src/shared/errors.ts)
- Global `errorMiddleware` is registered as the last middleware in `server.ts` — correctly catches forwarded errors.
  - [src/shared/middlewares.ts](src/shared/middlewares.ts)
- Controllers use an `asyncHandler` wrapper — no more `try/catch` boilerplate in route handlers.
- Sequelize-specific errors (`SequelizeUniqueConstraintError`, `SequelizeForeignKeyConstraintError`) are handled in the error middleware.
- Domain-level `DomainValidationError` is handled by the error middleware with a proper 400 response.
- 500 errors no longer leak internal `error.message` — a generic "An unexpected error occurred" is returned.
- Unhandled errors are logged via pino before sending generic response.
- Dead `CustomError` class has been removed.

**Remaining Issues:**

- _(None.)_

### 5. Input Validation

**Rating: Good**

Input validation is now handled by `zod` schemas applied via middleware on all routes. Each endpoint has a dedicated schema that validates request bodies and URL parameters before they reach controllers.

- [src/app/validation/schemas.ts](src/app/validation/schemas.ts) — All schemas defined here
- [src/app/validation/validate.ts](src/app/validation/validate.ts) — Reusable validation middleware
- Schemas validate: email format, string lengths, numeric types, enum values for account types, required fields
- URL `:id` params are validated as numeric values
- Auth routes validate registration (name, email, password min 8 chars) and login inputs

**Remaining gaps:**

- No sanitization library (e.g., `express-mongo-sanitize` or similar) — though Sequelize parameterization covers SQL injection

### 6. Design Patterns & Best Practices

**SOLID Analysis:**

| Principle                     | Status | Notes                                                                                                                         |
| ----------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **S** - Single Responsibility | ✅     | Entities handle data holding and validation with domain-specific errors. Controllers delegate to services via `asyncHandler`. |
| **O** - Open/Closed           | 🟡     | `RepositoryFactory` requires modification to add new DB types (switch statement). Could use a registry pattern.               |
| **L** - Liskov Substitution   | ✅     | All repository implementations fully implement their interfaces.                                                              |
| **I** - Interface Segregation | ✅     | Repository interfaces are focused per entity.                                                                                 |
| **D** - Dependency Inversion  | ✅     | Services depend on repository interfaces, not implementations.                                                                |

**DRY Violations:**

- ~~Each controller method has the same `try { ... } catch(error) { next(error) }` boilerplate.~~ ✅ Fixed: Extracted into `asyncHandler` utility.
- Repository Factory methods (`getUserRepository`, `getAccountRepository`, `getCategoryRepository`) follow identical logic with only the type/class differing. Could be generalized.

**Anti-patterns:**

- **Static controller methods with module-level service instantiation** — Services are instantiated at module import time (e.g., `const userService = new UserService(...)` at [src/app/controllers/UserController.ts](src/app/controllers/UserController.ts#L6)). This makes testing harder and creates hidden global state.
- **Console.log for debugging replaced with pino logger** — Factory now uses `logger.debug()` for diagnostic messages.
  - [src/app/factories/RepositoryFactory.ts](src/app/factories/RepositoryFactory.ts)

**Hardcoded values:**

- Port fallback `3000` is acceptable but should be documented.
- Docker Compose credentials (`root`, `lag`) are hardcoded — should use `.env` file.

### 7. Security

**Rating: Significantly improved**

| Issue                                                         | Severity        | Status          |
| ------------------------------------------------------------- | --------------- | --------------- |
| No authentication/authorization                               | ~~⛔ Critical~~ | ✅ Fixed (JWT)  |
| No CORS middleware                                            | ~~🔴 High~~     | ✅ Fixed        |
| No rate limiting                                              | ~~🔴 High~~     | ✅ Fixed        |
| No Helmet (security headers)                                  | ~~🔴 High~~     | ✅ Fixed        |
| Internal error messages exposed to client                     | ~~🔴 High~~     | ✅ Fixed        |
| No input sanitization                                         | ~~🔴 High~~     | ✅ Fixed (zod)  |
| Docker Compose hardcoded credentials                          | ~~🟡 Medium~~   | ✅ Fixed        |
| No SQL injection protection beyond Sequelize parameterization | 🟡 Medium       | Mitigated (zod) |
| No HTTPS enforcement                                          | 🟡 Medium       | Open            |

**Positive:** JWT-based auth with bcryptjs password hashing protects all resource endpoints. `cors`, `helmet`, and `express-rate-limit` middleware are configured. Error middleware no longer leaks internal details. All inputs are validated with zod schemas before reaching controllers.

### 8. TypeScript Quality

**Rating: Good — strict config with proper typing**

**Positives:**

- `"strict": true` in `tsconfig.json` — enables all strict checks
- `esModuleInterop` and `forceConsistentCasingInFileNames` enabled
- Repository interfaces are well-typed
- Entity constructors now use properly typed interfaces (`UserProps`, `AccountProps`, `CategoryProps`) instead of `any`
- `CategoryService` methods now have explicit return types
- `any` usage in error middleware replaced with typed object

**Remaining Issues:**

| Issue                                                      | File                                                         | Line       |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ---------- |
| ~~`any` in model loader~~                                  | [src/domain/models/index.ts](src/domain/models/index.ts#L10) | ✅ Fixed   |
| ~~Missing `@types/node` in devDependencies~~               | [package.json](package.json)                                 | ✅ Fixed   |
| ~~`noUnusedLocals` and `noUnusedParameters` are disabled~~ | [tsconfig.json](tsconfig.json)                               | ✅ Enabled |
| ~~`noImplicitReturns` is disabled~~                        | [tsconfig.json](tsconfig.json)                               | ✅ Enabled |

**Recommendation:** ~~Enable additional tsconfig strict options:~~ ✅ Done — all four options now enabled.

```json
"noUnusedLocals": true,
"noUnusedParameters": true,
"noImplicitReturns": true,
"noFallthroughCasesInSwitch": true
```

### 9. Dependencies Audit

#### To Update:

| Package          | Current Version | Recommended Action     | Reason                                                         |
| ---------------- | --------------- | ---------------------- | -------------------------------------------------------------- |
| `sequelize`      | ^6.37.5         | Evaluate upgrade to v7 | Sequelize 7 has been released with improved TypeScript support |
| `@types/express` | ^5.0.0          | Verify compatibility   | Ensure it matches Express 4.x typings                          |

#### To Remove:

| Package                                | Reason                        |
| -------------------------------------- | ----------------------------- |
| ~~`nodemon` (from `dependencies`)~~    | ✅ Moved to `devDependencies` |
| ~~`typescript` (from `dependencies`)~~ | ✅ Moved to `devDependencies` |

#### To Add:

| Package                                                  | Reason                                             |
| -------------------------------------------------------- | -------------------------------------------------- |
| ~~`cors` + `@types/cors`~~                               | ✅ Added                                           |
| ~~`helmet`~~                                             | ✅ Added                                           |
| ~~`express-rate-limit`~~                                 | ✅ Added                                           |
| ~~`zod`~~                                                | ✅ Added                                           |
| ~~`swagger-jsdoc` + `swagger-ui-express`~~               | ✅ Added                                           |
| ~~`@types/swagger-jsdoc` + `@types/swagger-ui-express`~~ | ✅ Added                                           |
| ~~`pino`~~                                               | ✅ Added                                           |
| `@types/node` (devDep)                                   | ~~Node.js type definitions — not listed~~ ✅ Added |
| ~~`eslint` + `@typescript-eslint/*` (devDep)~~           | ✅ Added                                           |
| ~~`prettier` (devDep)~~                                  | ✅ Added                                           |
| ~~`jest` + `ts-jest` + `@types/jest` (devDep)~~          | ✅ Added                                           |
| ~~`supertest` + `@types/supertest` (devDep)~~            | ✅ Added                                           |

#### Security Concerns:

- No `npm audit` output available (no `package-lock.json` committed — it's in `.gitignore`)
- Without a lockfile, dependency versions are non-deterministic across installs

### 10. Environment & Configuration

**Rating: Good**

**Positives:**

- `.env.example` exists with all expected variables documented (including `JWT_SECRET`)
- `dotenv` is used and loaded in `server.ts` via `import "dotenv/config"`
- Configuration is centralized in `src/shared/constants.ts` via zod-validated `ENVIRONMENT` object
- `.env` is in `.gitignore`
- **Environment variables are validated at startup with zod** — missing or invalid values produce clear error messages and prevent server from starting

**Remaining Issues:**

- _(None — Docker Compose now references `.env` variables.)_

**Recommendation:** Use `zod` or `envalid` to validate environment variables at startup:

```typescript
import { z } from "zod";
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DB_TYPE: z.string().default("SEQ"),
  SEQ_HOST: z.string().min(1),
  SEQ_DATABASE: z.string().min(1),
  SEQ_USERNAME: z.string().min(1),
  SEQ_PASSWORD: z.string().min(1),
});
export const ENVIRONMENT = envSchema.parse(process.env);
```

### 11. Code Quality & Clean Code

**Dead Code:**

- ~~[src/index.ts](src/index.ts)~~ — ✅ Removed
- ~~[src/shared/types.ts](src/shared/types.ts)~~ — ✅ Removed
- ~~[src/shared/utils.ts](src/shared/utils.ts)~~ — ✅ Removed
- ~~`CustomError` class~~ — ✅ Removed from `errors.ts`
- ~~`Transaction` model is defined but has no controller, service, routes, or repository~~ — ✅ Fixed: Complete Transaction feature implemented

**Naming:**

- ~~Model files inconsistency~~ — ✅ Fixed: `Category.ts` → `CategoryModel.ts`, `Transaction.ts` → `TransactionModel.ts`
- ~~`idCategory` in `TransactionModel` vs `userId`, `fromAccountId`, `toAccountId` — inconsistent foreign key naming convention~~ — ✅ Fixed: Renamed `idCategory` to `categoryId`

**Console Logging:**

- ~~Debug `console.log` statements in RepositoryFactory~~ — ✅ Replaced with pino `logger.debug()`

**Code Style:**

- ~~No ESLint configuration~~ — ✅ Fixed: ESLint 10 with flat config (`eslint.config.mjs`), `typescript-eslint`, and `eslint-config-prettier`.
- ~~No Prettier configuration~~ — ✅ Fixed: `.prettierrc` configured with consistent formatting rules. Scripts: `npm run lint`, `npm run format`.

### 12. Testing

**Status: Comprehensive test suite ✅**

Jest with ts-jest is configured. 136 tests across 11 suites all pass. Coverage includes entity validation (including Transaction), all service methods (including TransactionService with balance management), error middleware (including `DomainValidationError` handling), and full HTTP request→response integration tests with supertest for all endpoints including transactions.

**Highest-risk areas to test first (ordered by priority):**

1. **Service layer** (`UserService`, `AccountService`, `CategoryService`) — Core business logic. Mock repository interfaces and test validation, error throwing, and data transformation.
2. **Entity validation** (`User.validate()`, `Account.validate()`, `Category.validate()`) — Ensure validation rules catch invalid data correctly.
3. **Error middleware** (`errorMiddleware`) — Ensure all error types produce correct HTTP responses.
4. **Repository Factory** — Ensure correct repository types are returned for each `DB_TYPE`.
5. **Integration tests** — Test full HTTP request → response cycle using `supertest` on the Express app.
6. **Repository implementations** — Test against a test database to verify CRUD operations.

**Recommended setup:**

```
npm install -D jest ts-jest @types/jest supertest @types/supertest
```

---

## Recommended Action Plan

### ~~Phase 1: Security & Stability (Critical — Do First)~~ ✅ COMPLETED

~~1. Add input validation library (`zod`) and validate all request inputs~~
~~2. Add authentication/authorization middleware (JWT with `jsonwebtoken`)~~
~~3. Install and configure `cors`, `helmet`, `express-rate-limit`~~
~~4. Fix error middleware to not leak internal error messages in 500 responses~~
~~5. Move `nodemon` and `typescript` to `devDependencies`~~
~~6. Commit `package-lock.json` (remove from `.gitignore`)~~
~~7. Add environment variable validation at startup~~

### ~~Phase 2: Code Quality (High Priority)~~ ✅ COMPLETED

~~8. Replace `any` types in entity constructors with proper interfaces (`UserProps`, `AccountProps`, `CategoryProps`)~~
~~9. Implement missing repository methods (`delete` for Account/Category, `update` for Category)~~
~~10. Add missing controller/route endpoints for delete/update operations~~
~~11. Standardize repository interface patterns (consistent `null` vs exception handling)~~
~~12. Remove dead code (`src/index.ts`, `shared/types.ts`, `shared/utils.ts`, `CustomError`)~~
~~13. Add a structured logging library (`pino`)~~
~~14. Fix model file naming inconsistency (`Category.ts` → `CategoryModel.ts`, `Transaction.ts` → `TransactionModel.ts`)~~

### ~~Phase 3: Testing (High Priority)~~ ✅ COMPLETED

~~15. Set up Jest with `ts-jest`~~
~~16. Write unit tests for all service methods~~
~~17. Write unit tests for entity validation~~
~~18. Write integration tests for all API endpoints using `supertest`~~
~~19. Add test scripts to `package.json` and CI pipeline~~

### ~~Phase 4: Documentation & DX (Medium Priority)~~ ✅ COMPLETED

~~20. Add Swagger/OpenAPI documentation with `swagger-jsdoc` + `swagger-ui-express`~~
~~21. Configure ESLint + Prettier~~
~~22. Extract `try/catch` boilerplate in controllers into an `asyncHandler` utility~~
~~23. Create domain-specific validation errors (separate from HTTP `ApiError`)~~
~~24. Add database migration strategy (Sequelize CLI migrations)~~

### ~~Phase 5: Architecture Refinement (Low Priority)~~ ✅ COMPLETED

25. ~~Add DTO layer between controllers and services~~ — ✅ Fixed in Phase 5
26. ~~Decouple entity validation from `ApiError` (use domain-specific errors)~~ — ✅ Fixed in Phase 4
27. ~~Consider converting `ACCOUNT_TYPES` / `TRANSACTION_TYPES` to `as const` objects with derived types~~ — ✅ Fixed in Phase 5
28. ~~Complete the Transaction feature (entity, repository, service, controller, routes) or remove the model~~ — ✅ Fixed in Phase 5
29. ~~Refactor `RepositoryFactory` to use a registry pattern for extensibility~~ — ✅ Fixed in Phase 5

---

## Changelog

### March 28, 2026 - Phase 1 & Phase 2 Fix Session

**Fixed points:**

- **Authentication/Authorization (Critical #1):** Added JWT-based auth with `jsonwebtoken` + `bcryptjs`. Auth routes at `/auth/register` and `/auth/login`. All resource routes (`/users`, `/accounts`, `/categories`) protected by `authMiddleware`.
- **Input Validation (Critical #2):** Added `zod` validation schemas for all endpoints. Validation middleware applied to all routes. Validates email format, string lengths, numeric types, enum values, and URL params.
- **Hardcoded DB Credentials (Critical #5):** Added `JWT_SECRET` env var requirement; DB credentials now validated at startup via zod schema (app fails fast with clear error if missing).
- **Unimplemented Repository Methods (Critical #6):** Implemented `AccountSeqRepository.delete()`, `CategorySeqRepository.delete()`, and `CategorySeqRepository.update()` with proper domain entity returns.
- **Entity Constructors `any` (High #7):** Replaced `any` with typed interfaces (`UserProps`, `AccountProps`, `CategoryProps`) in all entity constructors.
- **CORS (High #8):** Added `cors` middleware to `server.ts`.
- **Rate Limiting (High #9):** Added `express-rate-limit` middleware (100 req/15min).
- **`nodemon` in deps (High #10):** Moved to `devDependencies`.
- **`typescript` in deps (High #11):** Moved to `devDependencies`.
- **Helmet (High #12):** Added `helmet` middleware for HTTP security headers.
- **Error Leak (High #13):** 500 errors now return generic message; internal details logged via pino.
- **CategoryService return types (High #14):** Added explicit `Promise<>` return types to all methods.
- **Inconsistent null handling (High #15):** All repos now return `null` from `getById`; services handle null-to-NotFound. `IUserRepository` updated to `Promise<User | null>`.
- **ICategoryRepository signature mismatch (Medium #16):** Updated `update()` to `update(id, entity)` pattern matching other repos.
- **Console.log in Factory (Medium #17):** Replaced with pino `logger.debug()`.
- **No env validation (Medium #18):** Added zod schema validation for all env vars at startup.
- **Dead code index.ts (Medium #19):** Deleted `src/index.ts`.
- **Empty types.ts (Medium #20):** Deleted `src/shared/types.ts`.
- **No Logging Library (Medium #21):** Added `pino` + `pino-pretty` for structured logging.
- **Model naming (Medium #22):** Renamed `Category.ts` → `CategoryModel.ts`, `Transaction.ts` → `TransactionModel.ts`.
- **No deleteAccount endpoint (Medium #23):** Added `deleteAccount` to controller, service, and routes.
- **No updateCategory/deleteCategory endpoints (Medium #24):** Added both to controller, service, and routes.
- **package-lock.json gitignored (Low #27):** Removed from `.gitignore`.
- **Non-null assertions in Account (Low #28):** Fixed `balance` to use `??` instead of `||`, removed unnecessary `!` assertions.
- **wait() utility (Low #29):** Deleted with `src/shared/utils.ts`.

**Files created:**

- `src/shared/logger.ts`: Pino logger configuration
- `src/app/validation/schemas.ts`: Zod validation schemas for all endpoints
- `src/app/validation/validate.ts`: Express validation middleware
- `src/app/middlewares/authMiddleware.ts`: JWT authentication middleware
- `src/app/services/AuthService.ts`: Auth service (register/login with bcryptjs)
- `src/app/controllers/AuthController.ts`: Auth controller
- `src/app/routes/authRoutes.ts`: Auth routes (/auth/register, /auth/login)

**Files modified:**

- `package.json`: Added deps (zod, cors, helmet, express-rate-limit, pino, jsonwebtoken, bcryptjs); moved nodemon/typescript to devDeps; added devDeps (@types/cors, @types/jsonwebtoken, @types/bcryptjs, pino-pretty)
- `src/server.ts`: Added cors, helmet, rate-limit, auth middleware, auth routes, pino logger
- `src/shared/constants.ts`: Replaced plain object ENVIRONMENT with zod-validated schema
- `src/shared/errors.ts`: Removed unused `CustomError` class
- `src/shared/middlewares.ts`: Fixed 500 error leak, replaced `any` with typed object, added error logging via pino
- `src/domain/entities/User.ts`: Added `password` field, changed constructor param from `any` to `UserProps`, made id/createdAt/updatedAt optional in props
- `src/domain/entities/Account.ts`: Changed constructor param from `any` to `AccountProps`, fixed `balance` default to use `??`
- `src/domain/entities/Category.ts`: Added `CategoryProps` interface, changed constructor param from `any` to `CategoryProps`
- `src/domain/repositories/user/IUserRepository.ts`: Added `getByEmail()`, changed `getById` return to `Promise<User | null>`, changed `update` to accept `Partial<User>`
- `src/domain/repositories/user/UserSeqRepository.ts`: Implemented `getByEmail()`, changed `getById` to return `null` instead of throwing, ensured all methods return domain entities
- `src/domain/repositories/account/IAccountRepository.ts`: Changed `update` to accept `Partial<Account>`
- `src/domain/repositories/account/AccountSeqRepository.ts`: Implemented `delete()`, fixed `getById`/`getAll`/`create` to return domain entities
- `src/domain/repositories/category/ICategoryRepository.ts`: Changed `update` to `update(id, entity)` pattern
- `src/domain/repositories/category/CategorySeqRepository.ts`: Implemented `delete()` and `update()`, fixed all methods to return domain entities, updated import to `CategoryModel`
- `src/domain/models/UserModel.ts`: Added `password`, `createdAt`, `updatedAt` fields
- `src/domain/models/models.ts`: Updated imports for renamed files
- `src/domain/models/TransactionModel.ts` (renamed from `Transaction.ts`): Updated import for renamed `CategoryModel`
- `src/domain/models/CategoryModel.ts` (renamed from `Category.ts`): No content changes
- `src/app/services/UserService.ts`: Updated `getUserById` to handle null, updated `updateUser` param to `Partial<User>`
- `src/app/services/AccountService.ts`: Added `deleteAccount()`, updated `updateAccount` param to `Partial<Account>`
- `src/app/services/CategoryService.ts`: Added `updateCategory()`, `deleteCategory()`, added explicit return types
- `src/app/controllers/UserController.ts`: Removed `as User` casts
- `src/app/controllers/AccountController.ts`: Added `deleteAccount()`, removed `as Account` cast, removed unused imports
- `src/app/controllers/CategoryController.ts`: Added `updateCategory()`, `deleteCategory()`
- `src/app/routes/userRoutes.ts`: Added validation middleware to all routes
- `src/app/routes/accountRoutes.ts`: Added validation middleware, added DELETE route
- `src/app/routes/categoryRoutes.ts`: Added validation middleware, added PUT and DELETE routes
- `src/app/factories/RepositoryFactory.ts`: Replaced console.log with pino logger
- `.gitignore`: Removed `package-lock.json`
- `.env.example`: Added `JWT_SECRET`, updated default values

**Files deleted:**

- `src/index.ts`: Dead scratch/experimental code
- `src/shared/types.ts`: Empty file
- `src/shared/utils.ts`: `wait()` only used by dead `index.ts`

**Dependencies added:**

- `zod@^4.3.6`: Input validation for all request bodies and params
- `cors@^2.8.6`: CORS middleware
- `helmet@^8.1.0`: HTTP security headers
- `express-rate-limit@^8.3.1`: API rate limiting
- `pino@^10.3.1`: Structured logging
- `jsonwebtoken@^9.0.3`: JWT token generation and verification
- `bcryptjs@^3.0.3`: Password hashing
- `@types/cors@^2.8.19` (dev): Type definitions
- `@types/jsonwebtoken@^9.0.10` (dev): Type definitions
- `@types/bcryptjs@^2.4.6` (dev): Type definitions
- `pino-pretty@^13.1.3` (dev): Pretty-printed logs in development

### March 28, 2026 - Docker Compose Credentials Fix

**Fixed points:**

- **Hardcoded Database Credentials in docker-compose.yml (High #4):** Replaced hardcoded `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` with `.env` variable references (`${MYSQL_ROOT_PASSWORD}`, `${SEQ_DATABASE}`, `${SEQ_USERNAME}`, `${SEQ_PASSWORD}`). Docker Compose now shares the same `.env` file as the application.

**Files modified:**

- `docker-compose.yml`: Replaced hardcoded credentials with `${...}` env var interpolation
- `.env.example`: Added `MYSQL_ROOT_PASSWORD` variable under a Docker Compose section

**Dependencies added:**

- _(None)_

### March 28, 2026 - Phase 3 Testing Fix Session

**Fixed points:**

- **No Tests (Critical #1):** Set up Jest with ts-jest (diagnostics disabled for TS6 compatibility). Created 90 tests across 9 suites covering entity validation, service logic, error middleware, and full HTTP integration with supertest. All tests pass.

**Files created:**

- `jest.config.js`: Jest configuration with ts-jest preset and disabled diagnostics
- `src/app.ts`: Express app extracted from server.ts for testability with supertest
- `src/__tests__/entities/User.test.ts`: User entity constructor and validation tests (5 tests)
- `src/__tests__/entities/Account.test.ts`: Account entity constructor and validation tests (7 tests)
- `src/__tests__/entities/Category.test.ts`: Category entity constructor and validation tests (4 tests)
- `src/__tests__/services/UserService.test.ts`: UserService tests with mocked repository (9 tests)
- `src/__tests__/services/AccountService.test.ts`: AccountService tests with mocked repository (9 tests)
- `src/__tests__/services/CategoryService.test.ts`: CategoryService tests with mocked repository (9 tests)
- `src/__tests__/services/AuthService.test.ts`: AuthService register/login tests with mocked repo and constants (7 tests)
- `src/__tests__/middleware/errorMiddleware.test.ts`: Error middleware tests for all error types (5 tests)
- `src/__tests__/integration/api.test.ts`: Full HTTP integration tests for all endpoints — auth, users, accounts, categories, validation errors, auth errors (35 tests)

**Files modified:**

- `package.json`: Added test scripts (`test`, `test:watch`, `test:coverage`); added devDependencies (jest, ts-jest, @types/jest, supertest, @types/supertest)
- `src/server.ts`: Refactored to import `app` from `./app.ts` (only handles `app.listen()`)

**Dependencies added (dev):**

- `jest@^29.7.0`: Test framework
- `ts-jest@^29.3.4`: TypeScript preprocessor for Jest
- `@types/jest@^29.5.14`: Jest type definitions
- `supertest@^7.1.0`: HTTP assertion library for integration tests
- `@types/supertest@^6.0.2`: Supertest type definitions

### March 28, 2026 - Phase 4 Fix Session

**Fixed points:**

- **Swagger/OpenAPI Documentation (#20):** Added `swagger-jsdoc` + `swagger-ui-express` with OpenAPI 3.0 spec. All endpoints documented with JSDoc annotations on route files. Swagger UI mounted at `/api-docs`. Component schemas for all request/response types. Auth endpoints marked as public (no security), resource endpoints require Bearer JWT.
- **ESLint + Prettier (#21):** Configured ESLint 10 with flat config (`eslint.config.mjs`), `typescript-eslint`, and `eslint-config-prettier`. Added `.prettierrc` with project formatting rules. Added `lint`, `lint:fix`, `format`, and `format:check` scripts to `package.json`.
- **asyncHandler Utility (#22):** Created `src/shared/asyncHandler.ts` with a typed `asyncHandler` wrapper. Refactored all 4 controllers (`AuthController`, `UserController`, `AccountController`, `CategoryController`) to use it — eliminated all `try/catch` + `next(error)` boilerplate.
- **Domain-specific Validation Errors (#23):** Created `src/domain/errors.ts` with `DomainValidationError` class (includes optional `field` property). Refactored all entity `validate()` methods (`User`, `Account`, `Category`) to throw `DomainValidationError` instead of `ApiError`. Updated error middleware to handle `DomainValidationError` with a 400 response. Updated all entity, service, and middleware tests to match new error types.
- **Database Migration Strategy (#24):** Configured Sequelize CLI with `.sequelizerc` and `src/config/database.js`. Created initial migrations for all 4 tables (Users, Categories, Accounts, Transactions) with proper column types, constraints, and foreign keys. Added `db:migrate`, `db:migrate:undo`, and `db:migration:generate` scripts to `package.json`. Created `src/database/migrations/` and `src/database/seeders/` directories.

**Files created:**

- `src/config/swagger.ts`: Swagger/OpenAPI spec definition with all component schemas
- `eslint.config.mjs`: ESLint 10 flat config with typescript-eslint and prettier integration
- `.prettierrc`: Prettier formatting configuration
- `src/shared/asyncHandler.ts`: Typed async route handler wrapper
- `src/domain/errors.ts`: `DomainValidationError` class for domain-level validation
- `.sequelizerc`: Sequelize CLI path configuration
- `src/config/database.js`: Sequelize CLI database configuration (reads from `.env`)
- `src/database/migrations/20260328000001-create-users.js`: Users table migration
- `src/database/migrations/20260328000002-create-categories.js`: Categories table migration
- `src/database/migrations/20260328000003-create-accounts.js`: Accounts table migration
- `src/database/migrations/20260328000004-create-transactions.js`: Transactions table migration
- `src/database/seeders/.gitkeep`: Placeholder for seeders directory

**Files modified:**

- `src/app.ts`: Added `swagger-ui-express` import and mounted Swagger UI at `/api-docs`
- `src/app/routes/authRoutes.ts`: Added OpenAPI JSDoc annotations for `/auth/register` and `/auth/login`
- `src/app/routes/userRoutes.ts`: Added OpenAPI JSDoc annotations for all `/users` endpoints
- `src/app/routes/accountRoutes.ts`: Added OpenAPI JSDoc annotations for all `/accounts` endpoints
- `src/app/routes/categoryRoutes.ts`: Added OpenAPI JSDoc annotations for all `/categories` endpoints
- `src/app/controllers/AuthController.ts`: Refactored to use `asyncHandler`, removed try/catch
- `src/app/controllers/UserController.ts`: Refactored to use `asyncHandler`, removed try/catch
- `src/app/controllers/AccountController.ts`: Refactored to use `asyncHandler`, removed try/catch
- `src/app/controllers/CategoryController.ts`: Refactored to use `asyncHandler`, removed try/catch
- `src/domain/entities/User.ts`: Changed `validate()` to throw `DomainValidationError` instead of `ApiError`
- `src/domain/entities/Account.ts`: Changed `validate()` to throw `DomainValidationError` instead of `ApiError`
- `src/domain/entities/Category.ts`: Changed `validate()` to throw `DomainValidationError` instead of `ApiError`
- `src/shared/middlewares.ts`: Added `DomainValidationError` handler (400 response with field details)
- `package.json`: Added dependencies (swagger-jsdoc, swagger-ui-express), devDependencies (eslint, prettier, typescript-eslint, @eslint/js, eslint-config-prettier, @types/swagger-jsdoc, @types/swagger-ui-express, sequelize-cli), and new scripts (lint, format, db:migrate)
- `src/__tests__/entities/User.test.ts`: Updated to expect `DomainValidationError` instead of `ApiError`
- `src/__tests__/entities/Account.test.ts`: Updated to expect `DomainValidationError` instead of `ApiError`
- `src/__tests__/entities/Category.test.ts`: Updated to expect `DomainValidationError` instead of `ApiError`
- `src/__tests__/services/UserService.test.ts`: Updated entity validation assertion to `DomainValidationError`
- `src/__tests__/services/AccountService.test.ts`: Updated entity validation assertions to `DomainValidationError`
- `src/__tests__/services/CategoryService.test.ts`: Updated entity validation assertion to `DomainValidationError`
- `src/__tests__/services/AuthService.test.ts`: Updated entity validation assertion to `DomainValidationError`
- `src/__tests__/middleware/errorMiddleware.test.ts`: Added 2 new tests for `DomainValidationError` handling
- `src/__tests__/integration/api.test.ts`: Added swagger mock for test compatibility

**Dependencies added:**

- `swagger-jsdoc@^6.2.8`: OpenAPI spec generation from JSDoc annotations
- `swagger-ui-express@^5.0.1`: Swagger UI middleware for Express
- `@types/swagger-jsdoc@^6.0.4` (dev): Type definitions for swagger-jsdoc
- `@types/swagger-ui-express@^4.1.8` (dev): Type definitions for swagger-ui-express
- `eslint@^10.1.0` (dev): JavaScript/TypeScript linter
- `@eslint/js@^10.1.0` (dev): ESLint recommended rules for flat config
- `typescript-eslint@^8.33.1` (dev): TypeScript ESLint integration
- `@typescript-eslint/parser@^8.57.2` (dev): TypeScript parser for ESLint
- `@typescript-eslint/eslint-plugin@^8.57.2` (dev): TypeScript ESLint rules
- `eslint-config-prettier@^10.1.8` (dev): Disables ESLint rules that conflict with Prettier
- `prettier@^3.8.1` (dev): Code formatter
- `sequelize-cli@^6.6.5` (dev): Sequelize migration CLI

### March 28, 2026 - Phase 5 Transaction Feature Fix Session

**Fixed points:**

- **Transaction Feature (#28):** Implemented the complete Transaction feature with entity, repository (interface + Sequelize implementation), service (with account balance management for income/expense/transfer flows), controller (using asyncHandler), routes (with Zod validation and OpenAPI documentation), and comprehensive tests. The TransactionModel was updated to rename `idCategory` to `categoryId` for naming consistency, and `tags` + `note` fields were added. The migration was updated to match.

**Files created:**

- `src/domain/entities/Transaction.ts`: Transaction domain entity with type-specific validation (EXPENSE requires fromAccountId, INCOME requires toAccountId, TRANSFER requires both and they must differ)
- `src/domain/repositories/transaction/ITransactionRepository.ts`: Transaction repository interface (CRUD)
- `src/domain/repositories/transaction/TransactionSeqRepository.ts`: Sequelize implementation of ITransactionRepository
- `src/app/services/TransactionService.ts`: Transaction service with account balance management — applies/reverses balance changes on create/update/delete. Includes TODO placeholder for future budget feature integration.
- `src/app/controllers/TransactionController.ts`: Transaction controller using asyncHandler pattern
- `src/app/routes/transactionRoutes.ts`: CRUD routes with Zod validation and OpenAPI JSDoc annotations
- `src/__tests__/entities/Transaction.test.ts`: Transaction entity constructor and validation tests (15 tests)
- `src/__tests__/services/TransactionService.test.ts`: TransactionService tests with mocked repos — covers all CRUD operations, balance updates for all transaction types, error cases (15 tests)

**Files modified:**

- `src/app.ts`: Added transaction routes (`/transactions`)
- `src/app/validation/schemas.ts`: Added `createTransactionSchema` and `updateTransactionSchema` with type-specific superRefine validation
- `src/app/factories/RepositoryFactory.ts`: Added `getTransactionRepository()` method
- `src/domain/models/TransactionModel.ts`: Renamed `idCategory` to `categoryId`, added `tags` and `note` fields, added UserModel association
- `src/database/migrations/20260328000004-create-transactions.js`: Renamed `idCategory` to `categoryId`, added `tags` and `note` columns
- `src/config/swagger.ts`: Added Transaction, CreateTransaction, UpdateTransaction component schemas
- `src/__tests__/integration/api.test.ts`: Added mockTransactionRepo, testTransaction data, and 14 transaction route integration tests (CRUD + validation errors)
- `AUDIT_REPORT.md`: Updated executive summary, section 1, section 11, section 12, phase 5 status, and added this changelog entry

**Dependencies added:**

- _(None — all required dependencies were already installed from previous phases)_

### March 29, 2026 - Phase 5 Architecture Refinement Fix Session

**Fixed points:**

- **DTO Layer (#25):** Created DTO interfaces for all entities (`CreateUserDTO`, `UpdateUserDTO`, `UserResponseDTO`, `CreateAccountDTO`, `UpdateAccountDTO`, `CreateCategoryDTO`, `UpdateCategoryDTO`, `CreateTransactionDTO`, `UpdateTransactionDTO`). All service methods now accept DTOs instead of domain entities for create/update operations. `AuthService.register` uses `CreateUserDTO`, return types use `UserResponseDTO`. This decouples HTTP request shapes from domain objects.
- **`as const` Types (#27):** Converted `DB_TYPES`, `MODEL_NAMES`, `ACCOUNT_TYPES`, and `TRANSACTION_TYPES` to `as const` objects. Exported derived union types (`DbType`, `AccountType`, `TransactionType`) for type-safe usage throughout the codebase. Entity types now use these aliases instead of `keyof typeof X` indirection.
- **RepositoryFactory Registry Pattern (#29):** Refactored `RepositoryFactory` from repetitive per-entity getter methods to a generic registry pattern. Uses a `Map<string, () => unknown>` for creators and `Map<string, unknown>` for caching. A public `register(key, creator)` method allows external registration of new repository types. Typed getter methods (`getUserRepository()`, etc.) delegate to the generic `getRepository<T>(key)`. Eliminates ~60 lines of boilerplate.

**Files created:**

- `src/app/dtos/UserDTO.ts`: CreateUserDTO, UpdateUserDTO, UserResponseDTO interfaces
- `src/app/dtos/AccountDTO.ts`: CreateAccountDTO, UpdateAccountDTO interfaces
- `src/app/dtos/CategoryDTO.ts`: CreateCategoryDTO, UpdateCategoryDTO interfaces
- `src/app/dtos/TransactionDTO.ts`: CreateTransactionDTO, UpdateTransactionDTO interfaces

**Files modified:**

- `src/shared/constants.ts`: Added `as const` to all constant objects; exported `DbType`, `AccountType`, `TransactionType` union types
- `src/app/factories/RepositoryFactory.ts`: Refactored to registry pattern with `register()`, `getRepository<T>()`, `REPO_KEYS`, lazy init + caching
- `src/domain/entities/Account.ts`: Made `id` and `balance` optional in `AccountProps`; used `AccountType` alias; changed class fields from `AccountProps["x"]` to direct types
- `src/domain/entities/Category.ts`: Made `id` optional in `CategoryProps`; changed class fields from `CategoryProps["x"]` to direct types
- `src/domain/entities/Transaction.ts`: Used `TransactionType` alias instead of `keyof typeof TRANSACTION_TYPES`
- `src/app/services/UserService.ts`: Changed `createUser`/`updateUser` to accept DTOs; imported DTO types
- `src/app/services/AccountService.ts`: Changed `createAccount`/`updateAccount` to accept DTOs
- `src/app/services/CategoryService.ts`: Changed `createCategory`/`updateCategory` to accept DTOs
- `src/app/services/TransactionService.ts`: Changed `createTransaction`/`updateTransaction` to accept DTOs
- `src/app/services/AuthService.ts`: Changed `register` to accept `CreateUserDTO`, return `UserResponseDTO`; login returns `UserResponseDTO`
- `src/__tests__/services/UserService.test.ts`: Updated create/update tests to pass DTO objects
- `src/__tests__/services/AccountService.test.ts`: Updated create/update tests to pass DTO objects
- `src/__tests__/services/CategoryService.test.ts`: Updated create/update tests to pass DTO objects
- `src/__tests__/services/TransactionService.test.ts`: Split test data into DTOs (for create calls) and stored entities (for mock returns)
- `AUDIT_REPORT.md`: Marked all Phase 5 items as completed

**Dependencies added:**

- _(None)_

### March 29, 2026 - Remaining Issues Cleanup

**Fixed points:**

- **`any` in model loader (#10):** Replaced `let dbModels: any = {}` with `const dbModels: Record<string, ModelStatic<Model>> = {}` in `loadSequelizeModels`.
- **Missing `@types/node` (#12):** Installed `@types/node` as a devDependency.
- **tsconfig strict options (Section 8):** Enabled `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and `noFallthroughCasesInSwitch`.
- **Dead import in swagger.ts:** Removed unused `import { format } from "sequelize/types/utils"`.
- **Unused parameter in app.ts:** Changed `(req, res)` to `(_req, res)` in health check route to satisfy `noUnusedParameters`.

**Files modified:**

- `src/domain/models/index.ts`: `any` → `Record<string, ModelStatic<Model>>`
- `src/config/swagger.ts`: Removed unused `format` import
- `src/app.ts`: Prefixed unused `req` parameter with `_`
- `tsconfig.json`: Enabled 4 additional strict options
- `package.json`: Added `@types/node` devDependency

**Dependencies added:**

- `@types/node` (dev): Node.js type definitions
