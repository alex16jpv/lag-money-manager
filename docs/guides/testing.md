# Testing Guide

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

All test commands include `--forceExit --detectOpenHandles` flags to ensure clean termination.

The suite is **374 tests across 20 files** and runs in a few seconds — no database, no network.

## The CI Gate

```bash
npm run ci
```

That is exactly what `.github/workflows/ci.yml` runs, in order:

```
npm run typecheck        # tsc --noEmit over src/
npm run typecheck:tests  # tsc -p tsconfig.test.json (tests are type-checked separately)
npm run lint             # eslint src/
npm test                 # jest
```

Tests are type-checked by a separate pass because Jest runs with `diagnostics: false` — a type error inside a test file will **not** fail `npm test`, only `npm run typecheck:tests`. Run `npm run ci` before pushing.

## Test Structure

Tests live in `src/__tests__/` organized by the type of code being tested:

```
src/__tests__/
├── entities/              # Domain entity unit tests
│   ├── Account.test.ts
│   ├── Category.test.ts
│   ├── Transaction.test.ts
│   └── User.test.ts
├── factories/             # RepositoryFactory registration/caching
│   └── RepositoryFactory.test.ts
├── integration/           # Full API tests through the Express app (Mongo mocked)
│   └── api.test.ts
├── middleware/            # Middleware unit tests
│   ├── authMiddleware.test.ts
│   ├── authRateLimitMiddleware.test.ts
│   ├── errorMiddleware.test.ts
│   ├── requestIdMiddleware.test.ts
│   └── requestLogMiddleware.test.ts
├── services/              # Service layer unit tests
│   ├── AccountService.test.ts
│   ├── AuthService.test.ts
│   ├── BudgetService.test.ts
│   ├── CategoryService.test.ts
│   ├── TransactionService.test.ts
│   └── UserService.test.ts
├── shared/                # Pure helpers
│   └── budgetPeriod.test.ts
└── validation/            # Zod schemas and the validate() middleware
    ├── schemas.test.ts
    └── validate.test.ts
```

**Naming convention:** `[OriginalFileName].test.ts`

**Test discovery pattern:** `**/__tests__/**/*.test.ts` (configured in `jest.config.js`)

## What Is Tested

| Type                  | What is tested                                                                                                     | Files                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| **Entity tests**      | Constructor, property assignment, default values, null coalescing                                                  | `entities/*.test.ts`              |
| **Service tests**     | Business logic, ownership checks, error codes, CRUD, balance adjustments — against **mocked repositories**         | `services/*.test.ts`              |
| **Validation tests**  | Every Zod schema (the largest single file, ~105 cases) and the `validate()` middleware's whitelisting + error shape | `validation/*.test.ts`            |
| **Middleware tests**  | JWT auth, the Mongo-backed auth rate limiter, error classification and status mapping, request id, request logging  | `middleware/*.test.ts`            |
| **Factory tests**     | Provider registration, typed getters, instance caching                                                             | `factories/RepositoryFactory.test.ts` |
| **Integration tests** | Full HTTP request/response cycle through the real Express app                                                      | `integration/api.test.ts`         |

## What Is NOT Tested (and Why)

- **Repository implementations** — thin Mongoose wrappers; exercising them needs a real replica set, which is integration-testing territory
- **Route definitions** — routes are wired declaratively; behavior is covered by the integration test
- **Controllers** — thin HTTP handlers; covered by service + integration tests
- **Config files** — static configuration, not behavioral code

### Known limitation: no real MongoDB anywhere

No test opens a database connection. Service tests receive mocked repositories through the constructor; `integration/api.test.ts` mocks `RepositoryFactory`, `connectMongo` and `withTransaction` before importing the app. A whole class of guarantees is therefore out of the suite's reach:

- **Partial unique indexes** — "at most one active default account per user" (`AccountModel`), the no-overlap budget key on `{userId, type, periodType, categoryIds}` (`BudgetModel`) and the unique active category name (`CategoryModel`) are enforced by MongoDB indexes, not by application code. Nothing in the suite can catch an index that was never created, or one that `db:sync-indexes` dropped.
- **Collation** — the case-insensitive uniqueness of category names comes from `collation: { locale: "es", strength: 2 }` on that index. Untested here.
- **Real atomicity** — `withTransaction` is replaced by a stub that just calls the callback with a fake session, so multi-document transactions, commit conflicts and `$inc` atomicity are never exercised. A green suite says nothing about behavior under concurrency.
- **TTL expiry** — rate-limit, idempotency and refresh-session documents expire via TTL indexes, which never run in tests.

Treat those areas as verified by review and by manual/staging checks against a real replica set, not by `npm test`.

## Writing a New Test

### Critical: Mock `shared/constants` First

The `shared/constants.ts` module eagerly parses environment variables at import time using Zod. **Every test file must mock this module before importing any source code:**

```typescript
jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "MONGO",
    JWT_SECRET: "test",
    JWT_EXPIRATION: "15m",
    REFRESH_TOKEN_EXPIRATION: "30d",
    BCRYPT_SALT_ROUNDS: 12,
    CORS_ORIGIN: "http://localhost:5173",
    RATE_LIMIT_MAX: 100000,
    AUTH_RATE_LIMIT_MAX: 100000,
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  DB_TYPES: { MONGO: "MONGO" },
  ACCOUNT_TYPES: {
    CASH: "CASH",
    ACCOUNT: "ACCOUNT",
    CARD: "CARD",
    DEBIT_CARD: "DEBIT_CARD",
    SAVINGS: "SAVINGS",
    INVESTMENT: "INVESTMENT",
    OVERDRAFT: "OVERDRAFT",
    LOAN: "LOAN",
    OTHER: "OTHER",
  },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
    ADJUSTMENT: "ADJUSTMENT",
  },
  CATEGORY_TYPES: { INCOME: "INCOME", EXPENSE: "EXPENSE" },
  BUDGET_TYPES: { EXPENSE: "EXPENSE", INCOME: "INCOME" },
  BUDGET_PERIOD_TYPES: {
    WEEKLY: "WEEKLY",
    BIWEEKLY: "BIWEEKLY",
    MONTHLY: "MONTHLY",
    QUARTERLY: "QUARTERLY",
    YEARLY: "YEARLY",
    CUSTOM: "CUSTOM",
  },
  COLORS: { RED: "RED", GREEN: "GREEN" /* ...the full COLORS map */ },
  MODEL_NAMES: {
    USER: "User",
    ACCOUNT: "Account",
    TRANSACTION: "Transaction",
    BUDGET: "Budget",
    CATEGORY: "Category",
  },
}));
```

Only mock the keys the code under test actually reads — but note that the mock **replaces the whole module**, so a missing key surfaces as `undefined` at import time (typically `Object.keys(undefined)` in a schema or model). Copy the block from a neighboring test in the same folder rather than trimming it by hand. `src/__tests__/integration/api.test.ts` carries the most complete version.

### Service Test Pattern

```typescript
// 1. Mock constants (MUST be first — see above)
jest.mock("../../shared/constants", () => ({ ... }));

// 2. Import source code AFTER mocks
import { AccountService } from "../../app/services/AccountService";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { Account } from "../../domain/entities/Account";
import { ApiError } from "../../shared/errors";

// 3. Create mock repositories — one per constructor dependency, with EVERY
//    method of the interface (jest.Mocked<T> requires the full surface)
const createMockRepo = (): jest.Mocked<IAccountRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  incrementBalance: jest.fn().mockResolvedValue(true),
  archiveNonDefault: jest.fn().mockResolvedValue(true),
  restore: jest.fn(),
  getDefaultByUserId: jest.fn(),
  setDefault: jest.fn(),
  countByUserId: jest.fn().mockResolvedValue(0),
});

// 4. Test suite
describe("AccountService", () => {
  let service: AccountService;
  let repo: jest.Mocked<IAccountRepository>;
  let userRepo: jest.Mocked<IUserRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    userRepo = createMockUserRepo();
    service = new AccountService(repo, userRepo);
  });

  describe("getAccountById", () => {
    it("returns the account when found and owned by the user", async () => {
      const account = new Account({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        name: "Savings",
        type: "SAVINGS",
        balance: 1000,
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      });
      repo.getByIdIncludingArchived.mockResolvedValue(account);

      const result = await service.getAccountById(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      expect(result.name).toBe("Savings");
    });

    it("throws NotFound when the account does not exist", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(
        service.getAccountById("nonexistent-id", "user-id"),
      ).rejects.toThrow(ApiError);
    });

    it("throws NotFound — not Forbidden — for someone else's account", async () => {
      const account = new Account({
        id: "account-id",
        name: "Other",
        type: "CASH",
        userId: "other-user-id",
      });
      repo.getByIdIncludingArchived.mockResolvedValue(account);

      await expect(
        service.getAccountById("account-id", "my-user-id"),
      ).rejects.toThrow("Account not found");
    });
  });
});
```

> Note the last case: on user-scoped reads a foreign resource is reported as **404, not 403** — a 403 would confirm that the id exists. Assert the code/message, not just `ApiError`.

### Entity Test Pattern

```typescript
jest.mock("../../shared/constants", () => ({ ... }));

import { Account } from "../../domain/entities/Account";

describe("Account Entity", () => {
  it("should create an account with all properties", () => {
    const account = new Account({
      id: "test-id",
      name: "Savings",
      type: "SAVINGS",
      balance: 1000,
      userId: "user-id",
    });

    expect(account.id).toBe("test-id");
    expect(account.name).toBe("Savings");
    expect(account.balance).toBe(1000);
  });

  it("should default balance to 0", () => {
    const account = new Account({
      name: "Cash",
      type: "CASH",
      userId: "user-id",
    });

    expect(account.balance).toBe(0);
  });
});
```

## How to Mock Dependencies

### Mock a repository

`jest.Mocked<T>` demands every method of the interface, so start from the interface file (`src/domain/repositories/<entity>/I<Entity>Repository.ts`) — it extends `IRepository<T>` (`getById`, `getAll`, `create`, `update`, `delete`) and adds the entity-specific ones. Give the methods a sensible default where "not configured" would otherwise mean `undefined`:

```typescript
const createMockRepo = (): jest.Mocked<IAccountRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  incrementBalance: jest.fn().mockResolvedValue(true),
  archiveNonDefault: jest.fn().mockResolvedValue(true),
  restore: jest.fn(),
  getDefaultByUserId: jest.fn(),
  setDefault: jest.fn(),
  countByUserId: jest.fn().mockResolvedValue(0),
});
```

Adding a method to a repository interface therefore breaks `npm run typecheck:tests` until every mock is updated — that is the intended pressure, not an inconvenience to work around with `as any`.

### Mock a transaction

Services that write across documents go through `withTransaction`. Replace it with a pass-through so the callback runs against the mocked repositories:

```typescript
jest.mock("../../shared/unitOfWork", () => ({
  withTransaction: jest.fn((fn: (session: unknown) => unknown) => fn({})),
}));
```

### Mock a resolved/rejected value

```typescript
repo.getById.mockResolvedValue(someEntity); // Success
repo.getById.mockResolvedValue(null); // Not found
repo.create.mockRejectedValue(new Error("fail")); // Error
```

### Mock sequential calls

```typescript
repo.getById
  .mockResolvedValueOnce(firstAccount)
  .mockResolvedValueOnce(secondAccount);
```

## Test Coverage

Run coverage with:

```bash
npm run test:coverage
```

### Coverage Targets

No minimum coverage threshold is currently enforced in `jest.config.js`. The following targets serve as guidelines for the project:

| Layer          | Target | Rationale                                                      |
| -------------- | ------ | -------------------------------------------------------------- |
| **Entities**   | 100%   | Pure constructors with simple logic — easy to cover completely |
| **Services**   | ≥ 90%  | Core business logic; high coverage ensures correctness         |
| **Middleware** | ≥ 85%  | Error handling and auth — critical paths must be verified      |
| **Validation** | ≥ 80%  | Schema validation and `validate()` middleware                  |
| **Overall**    | ≥ 80%  | Aggregate project target                                       |

### What Is NOT Covered (by design)

The following are intentionally excluded from coverage targets (see "What Is NOT Tested" section above):

- **Repository implementations** — thin Mongoose wrappers; they need a real replica set, not a unit test
- **Route definitions** — declarative wiring tested through integration tests
- **Controllers** — thin HTTP handlers covered by service + integration tests
- **Config files** — static configuration, not behavioral code

### Enforcing Coverage

To enforce coverage thresholds, add the following to `jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
},
```

## Jest Configuration

See `jest.config.js`:

```javascript
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
  transformIgnorePatterns: ["/node_modules/(?!uuid/)"],
  transform: {
    "^.+\\.[jt]s$": [
      "ts-jest",
      { diagnostics: false, tsconfig: { allowJs: true } },
    ],
  },
};
```

Key settings:

- `clearMocks: true` — automatically clears mock state between tests
- `diagnostics: false` — TypeScript errors do not fail `npm test`; `npm run typecheck:tests` is what catches them
- `transformIgnorePatterns` + `allowJs` — `uuid` ships ESM, so it must be transformed instead of skipped like the rest of `node_modules`
- `forceExit` and `detectOpenHandles` — set in the npm scripts, not here
