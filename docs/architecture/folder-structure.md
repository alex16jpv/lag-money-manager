# Folder Structure

## Directory Tree

```
lag-money-manager/
├── docs/                          # Project documentation (you are here)
├── requests/                      # `.http` request examples (REST client)
├── scripts/                       # Deploy and ops scripts (Lambda, keepalive, index sync)
├── src/
│   ├── app.ts                     # Express app setup and middleware registration
│   ├── server.ts                  # HTTP server bootstrap and start
│   ├── lambda.ts                  # AWS Lambda handler (serverless-express adapter)
│   ├── __tests__/                 # All test files
│   │   ├── entities/              # Domain entity unit tests
│   │   ├── factories/             # Repository factory unit tests
│   │   ├── integration/           # API integration tests (supertest)
│   │   ├── middleware/            # Middleware unit tests
│   │   ├── services/              # Service layer unit tests
│   │   ├── shared/                # Shared utility unit tests
│   │   └── validation/            # Zod schema and validate() unit tests
│   ├── app/                       # Application layer (HTTP-aware)
│   │   ├── controllers/           # Route handlers (thin, delegate to services)
│   │   ├── dtos/                  # Data Transfer Objects (input/output shapes)
│   │   ├── factories/             # Repository factory and DB providers
│   │   │   └── providers/         # DB provider registration (mongoProvider.ts)
│   │   ├── middlewares/           # Application-level middleware
│   │   ├── routes/                # Express route definitions with OpenAPI docs
│   │   ├── services/              # Business logic layer
│   │   └── validation/            # Zod schemas and validation middleware
│   ├── config/                    # Mongo connection, DB health ping, Swagger spec
│   ├── database/
│   │   └── seeders/               # Seed files (empty)
│   ├── domain/                    # Domain layer (framework-agnostic)
│   │   ├── errors.ts              # Domain validation error class
│   │   ├── entities/              # Business entity classes
│   │   └── repositories/          # Repository INTERFACES only
│   │       ├── IRepository.ts     # Generic base repository interface
│   │       ├── account/           # IAccountRepository.ts
│   │       ├── budget/            # IBudgetRepository.ts
│   │       ├── category/          # ICategoryRepository.ts
│   │       ├── idempotency/       # IIdempotencyRepository.ts
│   │       ├── refreshSession/    # IRefreshSessionRepository.ts
│   │       ├── transaction/       # ITransactionRepository.ts
│   │       └── user/              # IUserRepository.ts
│   ├── infrastructure/            # Persistence layer (Mongoose-specific)
│   │   ├── models/                # Mongoose schemas: [Entity]Model.ts
│   │   └── repositories/          # Concrete repositories, one dir per entity
│   └── shared/                    # Cross-cutting utilities and constants
├── docker-compose.yml             # Local dev containers (Mongo replica set, Mongoku)
├── package.json                   # Dependencies and scripts
├── tsconfig.json                  # TypeScript compiler config
├── tsconfig.test.json             # Type-check config for the test sources
├── jest.config.js                 # Jest test runner config
└── eslint.config.mjs              # ESLint + Prettier config
```

## Directory Details

### `src/`

Root source directory. Contains the entry-point files (`app.ts`, `server.ts`, `lambda.ts`) and all subdirectories.

- **What belongs here:** Only `app.ts`, `server.ts` and `lambda.ts` at the root level
- **What does NOT belong here:** Feature code, utilities, or config files at the root level
- **Naming:** `camelCase.ts`

---

### `src/__tests__/`

All test files, organized by the type of code being tested.

- **What belongs here:** Only `.test.ts` files
- **What does NOT belong here:** Source code, test fixtures that should be in a `fixtures/` subdirectory
- **Naming:** `[OriginalFileName].test.ts` (e.g., `TransactionService.test.ts`)

#### `src/__tests__/entities/`

Unit tests for domain entity constructors and validation logic.

#### `src/__tests__/integration/`

Full API integration tests using supertest against the Express app.

#### `src/__tests__/middleware/`

Unit tests for middleware functions (error handling, auth, request id, request log, auth rate limit).

#### `src/__tests__/services/`

Unit tests for service layer business logic with mocked repositories.

#### `src/__tests__/factories/`, `src/__tests__/shared/`, `src/__tests__/validation/`

Unit tests for the repository factory, the shared utilities (e.g. `budgetPeriod`), and the Zod schemas plus the `validate()` middleware.

---

### `src/app/`

Application layer. Contains all HTTP-aware code.

- **What belongs here:** Controllers, routes, services, DTOs, validation, middleware, factories
- **What does NOT belong here:** Database models, entity definitions, shared utilities
- **Naming:** Subdirectory per concern

---

### `src/app/controllers/`

Express route handler classes. Each controller is a class with static methods.

- **What belongs here:** One file per module: `[Entity]Controller.ts`
- **What does NOT belong here:** Business logic, direct database access, validation logic
- **Naming:** `PascalCase` with `Controller` suffix: `TransactionController.ts`

---

### `src/app/dtos/`

Data Transfer Object interfaces for input/output typing.

- **What belongs here:** One file per module: `[Entity]DTO.ts`
- **What does NOT belong here:** Validation logic, class implementations
- **Naming:** `PascalCase` with `DTO` suffix: `TransactionDTO.ts`

---

### `src/app/factories/`

Repository factory and database provider registrations.

- **What belongs here:** `RepositoryFactory.ts` and the `providers/` subdirectory
- **What does NOT belong here:** Service or controller factories
- **Naming:** `PascalCase` for factory, `camelCase` for providers

#### `src/app/factories/providers/`

Provider functions that register repository creators with the factory.

- **Files:** `mongoProvider.ts` (the only backend)
- **Naming:** `camelCase` with `Provider` suffix

---

### `src/app/middlewares/`

Application-level Express middleware.

- **What belongs here:** Authentication/authorization, the gateway-secret check, the persistent auth rate limiter, the DB-readiness guard, and the per-request completion log
- **What does NOT belong here:** Framework-agnostic middleware with no app-layer dependency (`requestId.ts` and the error handler live in `src/shared/`)
- **Files:** `authMiddleware.ts`, `authRateLimitMiddleware.ts`, `dbReadinessMiddleware.ts`, `gatewaySecretMiddleware.ts`, `requestLogMiddleware.ts`
- **Naming:** `camelCase` with `Middleware` suffix: `authMiddleware.ts`

---

### `src/app/routes/`

Express Router definitions with OpenAPI JSDoc annotations.

- **What belongs here:** One file per module: `[entity]Routes.ts`
- **What does NOT belong here:** Business logic, controller implementations
- **Naming:** `camelCase` with `Routes` suffix: `transactionRoutes.ts`

---

### `src/app/services/`

Business logic layer. Each service receives repository interfaces via constructor injection.

- **What belongs here:** One file per module: `[Entity]Service.ts`
- **What does NOT belong here:** HTTP request/response handling, direct database queries
- **Naming:** `PascalCase` with `Service` suffix: `TransactionService.ts`

---

### `src/app/validation/`

Zod validation schemas and the validation middleware factory.

- **What belongs here:** `schemas.ts` (all Zod schemas), `validate.ts` (middleware factory)
- **What does NOT belong here:** Business validation rules (those belong in services)
- **Naming:** `camelCase.ts`

---

### `src/config/`

Configuration files for external connections and tools.

- **What belongs here:** Database connections, Swagger config, third-party service configs
- **What does NOT belong here:** Application logic, middleware
- **Files:** `mongoConnection.ts` (idempotent connect, buffering disabled), `dbHealth.ts` (`/health/db` ping), `swagger.ts`
- **Naming:** `camelCase.ts`

---

### `src/database/`

Seed data placeholder. There are no migrations: MongoDB is schema-on-write, and indexes are declared on the Mongoose schemas and pushed by `npm run db:sync-indexes` (`scripts/sync-indexes.ts`) at deploy time.

- **What belongs here:** Seed files in `seeders/`
- **What does NOT belong here:** Model definitions, runtime code

---

### `src/domain/`

Domain layer — framework-agnostic business objects.

- **What belongs here:** Entities, repository interfaces, domain errors
- **What does NOT belong here:** Express-specific code, Mongoose models or queries, controllers, routes
- **Naming:** See subdirectories below

---

### `src/domain/entities/`

Plain TypeScript entity classes. No framework dependencies.

- **What belongs here:** One file per entity: `[Entity].ts`
- **What does NOT belong here:** ORM decorators, database-specific annotations
- **Naming:** `PascalCase.ts`: `Transaction.ts`, `Account.ts`

---

### `src/domain/repositories/`

Repository **interfaces** only — the contracts services depend on. The implementations live in `src/infrastructure/repositories/`.

- **What belongs here:** `IRepository.ts` (base interface) at root, one subdirectory per entity holding `I[Entity]Repository.ts` and its filter types
- **What does NOT belong here:** Any Mongoose import or query
- **Naming (interface):** `I[Entity]Repository.ts`

---

### `src/infrastructure/`

Persistence layer. Everything that knows about MongoDB lives here.

- **What belongs here:** Mongoose schemas/models and the concrete repositories
- **What does NOT belong here:** Business rules, HTTP concerns

---

### `src/infrastructure/models/`

Mongoose schema and model definitions, including the infrastructure-only collections (`IdempotencyKeyModel`, `RateLimitModel`, `RefreshSessionModel`) that have no domain entity.

- **What belongs here:** One model per collection, exporting the model and its `I[Entity]Document` interface
- **Naming:** `PascalCase` with `Model` suffix: `TransactionModel.ts`

---

### `src/infrastructure/repositories/`

Concrete repositories implementing the domain interfaces, one subdirectory per entity.

- **What belongs here:** `[entity]/[Entity]Repository.ts` — no `Mongo` suffix; MongoDB is the only backend
- **Responsibilities:** Map documents to domain entities (never return raw Mongoose docs), convert money between integer cents and decimals at this boundary, and accept an optional `TxSession` so callers can enlist the query in a unit of work
- **Naming:** `PascalCase` with `Repository` suffix: `TransactionRepository.ts`

---

### `src/shared/`

Cross-cutting utilities used by multiple layers.

- **What belongs here:** Constants, logger, pagination helpers, error classes, shared middleware, money/currency/timezone helpers
- **What does NOT belong here:** Feature-specific logic, database models
- **Files:** `budgetPeriod.ts`, `constants.ts`, `currency.ts`, `defaultCategories.ts`, `errors.ts`, `logger.ts`, `middlewares.ts`, `money.ts`, `pagination.ts`, `requestHash.ts`, `requestId.ts`, `timezone.ts`, `unitOfWork.ts`
- **Naming:** `camelCase.ts`
