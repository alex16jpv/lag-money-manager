# API Audit Report

**Date:** March 28, 2026  
**Project:** lag-money-manager (v1.0.0)  
**Stack:** Node.js / TypeScript 5.7 / Express 4.21 / Sequelize 6.37 (MySQL) / Docker Compose

---

## Executive Summary

The project implements a layered architecture with controllers, services, and repositories — a good foundation. After the Phase 1 and Phase 2 fix session, the API now has **JWT authentication/authorization**, **zod-based input validation**, **security middleware** (CORS, Helmet, rate limiting), **structured logging** with pino, and **environment variable validation at startup**. Entity constructors use proper TypeScript interfaces, all repository methods are implemented, and dead code has been removed. The remaining gaps are in **testing** (zero tests), **API documentation** (no Swagger/OpenAPI), and **architecture refinements** (DTOs, migration strategy, linting/formatting). The project is significantly closer to production-ready but testing and documentation remain critical.

---

## Critical Issues ⛔

1. **No Tests** — The test script in `package.json` is a placeholder (`echo "Error: no test specified" && exit 1`). There are zero unit, integration, or e2e tests.
   - [package.json](package.json#L6)

2. **No API Documentation (Swagger/OpenAPI)** — No swagger-jsdoc, swagger-ui-express, or any OpenAPI tooling is present. There is no machine-readable or human-readable API contract.

## High Priority 🔴

_(No remaining high-priority issues.)_

## Medium Priority 🟡

5. **No `deleteAccount` Endpoint** — ~~Fixed: `deleteAccount` method and `DELETE /:id` route added.~~

6. **No `updateCategory` or `deleteCategory` Endpoints** — ~~Fixed: `updateCategory`, `deleteCategory` methods and PUT/DELETE routes added.~~

7. **`sequelize.sync()` is Commented Out** — The model loading function in `index.ts` has `sequelize.sync()` commented out. Without migrations or sync, schema changes won't be applied.
   - [src/domain/models/index.ts](src/domain/models/index.ts#L22)

8. **No Database Migration Strategy** — There are no Sequelize migration files or CLI configuration. Schema management is entirely manual or relies on the commented-out `sync()`.

## Low Priority 🟢

9. **`package-lock.json` is in `.gitignore`** — ~~Fixed: removed from `.gitignore`.~~

10. **`dbModels` in `loadSequelizeModels` Uses `any`** — The local variable is typed as `any`, losing type safety.
    - [src/domain/models/index.ts](src/domain/models/index.ts#L10)

11. **`ACCOUNT_TYPES` and `TRANSACTION_TYPES` Should Be TypeScript Enums or `as const`** — Currently plain objects; no type narrowing benefit.
    - [src/shared/constants.ts](src/shared/constants.ts#L16-L34)

12. **Missing `@types/node` in devDependencies** — Node.js type definitions are not explicitly listed.
    - [package.json](package.json)

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
- Repository pattern with interfaces (`IUserRepository`, `IAccountRepository`, `ICategoryRepository`)
- `RepositoryFactory` centralizes repository instantiation with DB-type switching
- Domain entities are separate from Sequelize models

**Issues:**

- **Domain entities live in `domain/entities/` but also depend on `shared/errors.ts`** — entities should be pure domain objects. Validation could throw domain-specific errors rather than API-level errors (`ApiError` with HTTP status codes).
  - [src/domain/entities/User.ts](src/domain/entities/User.ts#L1) imports `ApiError`
  - [src/domain/entities/Account.ts](src/domain/entities/Account.ts#L1) imports `ApiError`
  - [src/domain/entities/Category.ts](src/domain/entities/Category.ts#L1) imports `ApiError`
- **No Transaction entity, controller, service, or routes** — `TransactionModel` exists but has no corresponding business layer. This is either incomplete work or dead code.
- **`src/index.ts` is a scratch/test file** that shouldn't exist in a production codebase.
- **No DTOs (Data Transfer Objects)** — Controllers cast `req.body` directly to domain entities. A DTO layer would decouple HTTP request shapes from domain objects.
- **No middleware layer for cross-cutting concerns** (auth, logging, request ID tracking).

### 2. Database Abstraction

**Rating: Good — consistent patterns**

**Positives:**

- Repository interfaces (`IUserRepository`, `IAccountRepository`, `ICategoryRepository`) abstract the data layer correctly
- `RepositoryFactory` supports swapping DB implementations via `DB_TYPE` env var
- Services depend on interfaces, not concrete implementations — good for testability and future DB swaps
- Sequelize models are separate from domain entities
- All repository implementations return domain entities (not raw Sequelize objects)
- All repository methods are implemented — no stub methods throwing errors
- Consistent `null` return pattern across all repositories for `getById`
- All repository interfaces use consistent `update(id, entity)` signature

**Issues:**

- **`RepositoryFactory` constructor calls `loadSequelizeModels()` as a side effect** — model loading is triggered by importing the factory, creating tight coupling between module load order and DB initialization.
  - [src/app/factories/RepositoryFactory.ts](src/app/factories/RepositoryFactory.ts#L19-L21)

**To achieve full DB-swappability:**

- All repository methods must return domain entities, never ORM-specific objects
- Model associations should be configured outside the model files to avoid import order issues
- Consider using a generic `IRepository<T>` base interface to standardize CRUD signatures

### 3. Swagger / API Documentation

**Status: Not Present ❌**

There is **no Swagger/OpenAPI configuration** anywhere in the project. No `swagger-jsdoc`, `swagger-ui-express`, or equivalent library is installed or configured.

**Impact:**

- No machine-readable API contract for frontend developers, QA, or external consumers
- No interactive documentation for testing endpoints
- Increases onboarding time and likelihood of integration bugs

**Recommendation:**
Install and configure `swagger-jsdoc` + `swagger-ui-express`:

```
npm install swagger-jsdoc swagger-ui-express
npm install -D @types/swagger-jsdoc @types/swagger-ui-express
```

- Define an OpenAPI 3.0 spec using JSDoc annotations on each route or a centralized YAML/JSON file
- Mount `swagger-ui-express` at `/api-docs` in `server.ts`
- Document all endpoints with request bodies, response schemas, status codes, and authentication requirements

### 4. Error Handling

**Rating: Good**

**Positives:**

- Custom `ApiError` class extends `BaseError` with `statusCode` and `details` — good structured approach.
  - [src/shared/errors.ts](src/shared/errors.ts)
- Global `errorMiddleware` is registered as the last middleware in `server.ts` — correctly catches forwarded errors.
  - [src/shared/middlewares.ts](src/shared/middlewares.ts)
- Controllers consistently use `try/catch` with `next(error)` — no unhandled promise rejections in route handlers.
- Sequelize-specific errors (`SequelizeUniqueConstraintError`, `SequelizeForeignKeyConstraintError`) are handled in the error middleware.
- 500 errors no longer leak internal `error.message` — a generic "An unexpected error occurred" is returned.
- Unhandled errors are logged via pino before sending generic response.
- Dead `CustomError` class has been removed.

**Remaining Issues:**

- Each controller method has the same `try { ... } catch(error) { next(error) }` boilerplate. This could be extracted into an `asyncHandler` wrapper.

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

| Principle                     | Status | Notes                                                                                                           |
| ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| **S** - Single Responsibility | 🟡     | Entities handle both data holding and validation. Domain entities throw HTTP-level errors (`ApiError`).         |
| **O** - Open/Closed           | 🟡     | `RepositoryFactory` requires modification to add new DB types (switch statement). Could use a registry pattern. |
| **L** - Liskov Substitution   | ✅     | All repository implementations fully implement their interfaces.                                                |
| **I** - Interface Segregation | ✅     | Repository interfaces are focused per entity.                                                                   |
| **D** - Dependency Inversion  | ✅     | Services depend on repository interfaces, not implementations.                                                  |

**DRY Violations:**

- Each controller method has the same `try { ... } catch(error) { next(error) }` boilerplate. This could be extracted into an `asyncHandler` wrapper.
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

| Issue                                                  | File                                                         | Line                     |
| ------------------------------------------------------ | ------------------------------------------------------------ | ------------------------ |
| `any` in model loader                                  | [src/domain/models/index.ts](src/domain/models/index.ts#L10) | `let dbModels: any = {}` |
| Missing `@types/node` in devDependencies               | [package.json](package.json)                                 | —                        |
| `noUnusedLocals` and `noUnusedParameters` are disabled | [tsconfig.json](tsconfig.json)                               | Commented out            |
| `noImplicitReturns` is disabled                        | [tsconfig.json](tsconfig.json)                               | Commented out            |

**Recommendation:** Enable additional tsconfig strict options:

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

| Package                                              | Reason                                       |
| ---------------------------------------------------- | -------------------------------------------- |
| ~~`cors` + `@types/cors`~~                           | ✅ Added                                     |
| ~~`helmet`~~                                         | ✅ Added                                     |
| ~~`express-rate-limit`~~                             | ✅ Added                                     |
| ~~`zod`~~                                            | ✅ Added                                     |
| `swagger-jsdoc` + `swagger-ui-express`               | API documentation — completely absent        |
| `@types/swagger-jsdoc` + `@types/swagger-ui-express` | Type definitions for Swagger packages        |
| ~~`pino`~~                                           | ✅ Added                                     |
| `@types/node` (devDep)                               | Node.js type definitions — not listed        |
| `eslint` + `@typescript-eslint/*` (devDep)           | Linting — no linter configured               |
| `prettier` (devDep)                                  | Code formatting — no formatter configured    |
| `jest` or `vitest` + `@types/jest` (devDep)          | Testing framework — no tests exist           |
| `supertest` + `@types/supertest` (devDep)            | HTTP assertion library for integration tests |

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
- `Transaction` model is defined but has no controller, service, routes, or repository

**Naming:**

- ~~Model files inconsistency~~ — ✅ Fixed: `Category.ts` → `CategoryModel.ts`, `Transaction.ts` → `TransactionModel.ts`
- `idCategory` in `TransactionModel` (line 10) vs `userId`, `fromAccountId`, `toAccountId` — inconsistent foreign key naming convention
  - [src/domain/models/TransactionModel.ts](src/domain/models/TransactionModel.ts#L10)

**Console Logging:**

- ~~Debug `console.log` statements in RepositoryFactory~~ — ✅ Replaced with pino `logger.debug()`

**Code Style:**

- No ESLint configuration — no automated style enforcement
- No Prettier configuration — no automated formatting

### 12. Testing

**Status: No tests exist ❌**

There are zero test files in the project. The `package.json` test script is a placeholder:

```json
"test": "echo \"Error: no test specified\" && exit 1"
```

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

### Phase 3: Testing (High Priority)

15. Set up Jest with `ts-jest`
16. Write unit tests for all service methods
17. Write unit tests for entity validation
18. Write integration tests for all API endpoints using `supertest`
19. Add test scripts to `package.json` and CI pipeline

### Phase 4: Documentation & DX (Medium Priority)

20. Add Swagger/OpenAPI documentation with `swagger-jsdoc` + `swagger-ui-express`
21. Configure ESLint + Prettier
22. Extract `try/catch` boilerplate in controllers into an `asyncHandler` utility
23. Create domain-specific validation errors (separate from HTTP `ApiError`)
24. Add database migration strategy (Sequelize CLI migrations)

### Phase 5: Architecture Refinement (Low Priority)

25. Add DTO layer between controllers and services
26. Decouple entity validation from `ApiError` (use domain-specific errors)
27. Consider converting `ACCOUNT_TYPES` / `TRANSACTION_TYPES` to `as const` objects with derived types
28. Complete the Transaction feature (entity, repository, service, controller, routes) or remove the model
29. Refactor `RepositoryFactory` to use a registry pattern for extensibility

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
