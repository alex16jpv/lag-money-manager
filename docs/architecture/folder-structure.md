# Folder Structure

## Directory Tree

```
lag-money-manager/
├── docs/                          # Project documentation (you are here)
├── src/
│   ├── app.ts                     # Express app setup and middleware registration
│   ├── server.ts                  # HTTP server bootstrap and start
│   ├── __tests__/                 # All test files
│   │   ├── entities/              # Domain entity unit tests
│   │   ├── integration/           # API integration tests (supertest)
│   │   ├── middleware/            # Middleware unit tests
│   │   └── services/              # Service layer unit tests
│   ├── app/                       # Application layer (HTTP-aware)
│   │   ├── controllers/           # Route handlers (thin, delegate to services)
│   │   ├── dtos/                  # Data Transfer Objects (input/output shapes)
│   │   ├── factories/             # Repository factory and DB providers
│   │   │   └── providers/         # DB-specific provider registrations
│   │   ├── middlewares/           # Application-level middleware (auth)
│   │   ├── routes/                # Express route definitions with OpenAPI docs
│   │   ├── services/              # Business logic layer
│   │   └── validation/            # Zod schemas and validation middleware
│   ├── config/                    # Configuration and connection setup
│   ├── database/                  # Database migrations and seeders
│   │   ├── migrations/            # Sequelize migration files
│   │   └── seeders/               # Sequelize seed files (empty)
│   ├── domain/                    # Domain layer (framework-agnostic)
│   │   ├── errors.ts              # Domain validation error class
│   │   ├── entities/              # Business entity classes
│   │   ├── models/                # ORM/ODM model definitions
│   │   │   ├── mongoose/          # Mongoose schema definitions
│   │   │   └── sequelize/         # Sequelize model definitions
│   │   └── repositories/          # Repository interfaces and implementations
│   │       ├── IRepository.ts     # Generic base repository interface
│   │       ├── account/           # Account repository (interface + 2 impls)
│   │       ├── category/          # Category repository (interface + 2 impls)
│   │       ├── transaction/       # Transaction repository (interface + 2 impls)
│   │       ├── unitOfWork/        # Unit of Work (placeholder, empty)
│   │       └── user/              # User repository (interface + 2 impls)
│   └── shared/                    # Cross-cutting utilities and constants
├── docker-compose.yml             # Local dev containers (MySQL, Mongo, admin tools)
├── package.json                   # Dependencies and scripts
├── tsconfig.json                  # TypeScript compiler config
├── jest.config.js                 # Jest test runner config
├── eslint.config.mjs              # ESLint + Prettier config
├── api.http                       # HTTP request examples (REST client)
└── AUDIT_REPORT.md                # Previous audit findings
```

## Directory Details

### `src/`

Root source directory. Contains the two entry-point files (`app.ts`, `server.ts`) and all subdirectories.

- **What belongs here:** Only `app.ts` and `server.ts` at the root level
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

Unit tests for middleware functions (error handling, auth).

#### `src/__tests__/services/`

Unit tests for service layer business logic with mocked repositories.

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

Database-specific provider functions that register repository creators.

- **Files:** `sequelizeProvider.ts`, `mongoProvider.ts`
- **Naming:** `camelCase` with `Provider` suffix

---

### `src/app/middlewares/`

Application-level Express middleware.

- **What belongs here:** Authentication middleware, authorization middleware
- **What does NOT belong here:** Global middleware (those go in `src/shared/`)
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
- **Files:** `database.js` (Sequelize CLI config), `sequelizeConnection.ts`, `mongoConnection.ts`, `swagger.ts`
- **Naming:** `camelCase.ts` (or `.js` for Sequelize CLI compatibility)

---

### `src/database/`

Database migration and seed files used by Sequelize CLI.

- **What belongs here:** Migration files in `migrations/`, seed files in `seeders/`
- **What does NOT belong here:** Model definitions, runtime code
- **Naming (migrations):** `YYYYMMDDHHMMSS-[description].js` (e.g., `20260328000001-create-users.js`)

---

### `src/domain/`

Domain layer — framework-agnostic business objects.

- **What belongs here:** Entities, repository interfaces, domain errors, ORM/ODM models
- **What does NOT belong here:** Express-specific code, controllers, routes
- **Naming:** See subdirectories below

---

### `src/domain/entities/`

Plain TypeScript entity classes. No framework dependencies.

- **What belongs here:** One file per entity: `[Entity].ts`
- **What does NOT belong here:** ORM decorators, database-specific annotations
- **Naming:** `PascalCase.ts`: `Transaction.ts`, `Account.ts`

---

### `src/domain/models/sequelize/`

Sequelize model definitions.

- **What belongs here:** One model per entity, plus `models.ts` (re-exports) and `index.ts` (loader)
- **Naming:** `PascalCase` with `Model` suffix: `TransactionModel.ts`

---

### `src/domain/models/mongoose/`

Mongoose schema and model definitions.

- **What belongs here:** One model per entity
- **Naming:** `PascalCase` with `MongoModel` suffix: `TransactionMongoModel.ts`

---

### `src/domain/repositories/`

Repository interfaces and their database-specific implementations, organized by entity.

- **What belongs here:** `IRepository.ts` (base interface) at root, one subdirectory per entity
- **Naming (interface):** `I[Entity]Repository.ts`
- **Naming (Sequelize impl):** `[Entity]SeqRepository.ts`
- **Naming (Mongoose impl):** `[Entity]MongoRepository.ts`

---

### `src/shared/`

Cross-cutting utilities used by multiple layers.

- **What belongs here:** Constants, logger, pagination helpers, error classes, shared middleware
- **What does NOT belong here:** Feature-specific logic, database models
- **Files:** `constants.ts`, `errors.ts`, `logger.ts`, `middlewares.ts`, `pagination.ts`, `requestId.ts`
- **Naming:** `camelCase.ts`
