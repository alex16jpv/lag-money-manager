# Glossary

**Account**
A financial account belonging to a user. Has a name, type (CASH, ACCOUNT, CARD, etc.), and a balance. Balances are modified automatically by the Transactions module.

**Account Type**
Classification of a financial account. Defined in `ACCOUNT_TYPES` constant. Values: CASH, ACCOUNT, CARD, DEBIT_CARD, SAVINGS, INVESTMENT, OVERDRAFT, LOAN, OTHER.

**ApiError**
The primary error class for expected/handled error conditions. Wraps an HTTP status code and message. Defined in `src/shared/errors.ts`.

**Auth Middleware**
Express middleware that verifies JWT tokens on protected routes. Extracts `userId` and `email` from the token and attaches them to `req.user`. Defined in `src/app/middlewares/authMiddleware.ts`.

**Balance Adjustment**
The process of updating account balances when transactions are created, updated, or deleted. Handled by `TransactionService.adjustBalances()`.

**Category**
A user-defined label for organizing transactions (e.g., "Food", "Transport", "Salary"). User-scoped — each user has their own categories.

**Controller**
A class with static methods that handle HTTP requests. Extracts data from the request, delegates to a service, and formats the HTTP response. Located in `src/app/controllers/`.

**Cursor-based Pagination**
Pagination using the last item's ID as a cursor for the next page. More efficient than offset for large datasets. Supported alongside offset pagination in all list endpoints.

**DB_TYPE**
Environment variable that selects the database backend at runtime. `SEQ` for MySQL/Sequelize, `MONGO` for MongoDB/Mongoose.

**Domain Entity**
A plain TypeScript class representing a business object (User, Account, Category, Transaction). Framework-agnostic — no ORM/ODM dependencies. Located in `src/domain/entities/`.

**DomainValidationError**
Error class for domain-level validation failures within entities. Defined in `src/domain/errors.ts`.

**DTO (Data Transfer Object)**
TypeScript interface defining the shape of data flowing into services. Separates the API boundary from the domain layer. Located in `src/app/dtos/`.

**ENVIRONMENT**
Validated environment variable object created by parsing `process.env` through a Zod schema. Defined in `src/shared/constants.ts`. Fail-fast: the app won't start if required variables are missing.

**Error Middleware**
Global Express error handler at the end of the middleware chain. Catches all errors, identifies their type, and returns structured JSON responses. Defined in `src/shared/middlewares.ts`.

**EXPENSE**
Transaction type where money flows out of a source account (`fromAccountId`). Decreases the account balance.

**Factory (Repository Factory)**
Centralized class that creates and caches repository instances. Selects the appropriate database implementation via providers. Defined in `src/app/factories/RepositoryFactory.ts`.

**INCOME**
Transaction type where money flows into a destination account (`toAccountId`). Increases the account balance.

**IRepository**
Generic base interface for all repositories. Defines `getById`, `getAll`, `create`, `update`, `delete`. Defined in `src/domain/repositories/IRepository.ts`.

**JWT (JSON Web Token)**
Authentication mechanism used for protected routes. Issued on login, contains `userId` and `email`. Verified by the auth middleware.

**Migration**
Sequelize migration file that modifies the MySQL database schema. Located in `src/database/migrations/`. Run with `npm run db:migrate`.

**Mongoose Model**
MongoDB schema definitions using Mongoose. Located in `src/domain/models/mongoose/`.

**Ownership Check**
Verification that the authenticated user owns the requested resource. Done by comparing `entity.userId` with `req.user.userId` in the service layer.

**Pagination**
System for returning large result sets in pages. Supports both offset-based (`limit`/`offset`) and cursor-based (`cursor`) pagination. Utilities in `src/shared/pagination.ts`.

**Provider**
A function that registers database-specific repository creators with the Repository Factory. One per database type. Located in `src/app/factories/providers/`.

**Repository**
Data access abstraction. An interface defines the contract (`I[Entity]Repository`), and implementations handle the database-specific queries (`[Entity]SeqRepository`, `[Entity]MongoRepository`).

**Request ID**
A UUID correlation identifier assigned to every request via the `X-Request-Id` header. Used for log tracing. Middleware in `src/shared/requestId.ts`.

**Route**
Express Router definition that maps HTTP methods/paths to validation middleware and controller methods. Located in `src/app/routes/`. Includes OpenAPI JSDoc annotations.

**Sequelize Model**
MySQL table/model definitions using Sequelize ORM. Located in `src/domain/models/sequelize/`.

**Service**
Business logic layer. Receives repository interfaces via constructor injection. Performs ownership checks, data transformations, and cross-entity operations. Located in `src/app/services/`.

**Transaction**
A financial record representing money movement. Has three types: INCOME, EXPENSE, TRANSFER. Automatically adjusts account balances on create/update/delete.

**TRANSFER**
Transaction type where money moves between two accounts. Decreases `fromAccountId` balance and increases `toAccountId` balance by the same amount.

**UUID v7**
Time-ordered universally unique identifier used for all entity IDs. Generated by the `uuid` package's `v7()` function. Stored as `CHAR(36)` in MySQL and `String` in MongoDB.

**Validation Middleware**
Express middleware factory that validates `req.body`, `req.query`, and `req.params` against a Zod schema. Returns 400 with field-level error details on failure. Defined in `src/app/validation/validate.ts`.

**Zod**
TypeScript-first schema validation library used for request validation and environment variable parsing. Version 4.x.
