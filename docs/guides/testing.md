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

## Test Structure

Tests live in `src/__tests__/` organized by the type of code being tested:

```
src/__tests__/
├── entities/              # Domain entity unit tests
│   ├── Account.test.ts
│   ├── Category.test.ts
│   ├── Transaction.test.ts
│   └── User.test.ts
├── integration/           # Full API integration tests
│   └── api.test.ts
├── middleware/             # Middleware unit tests
│   └── errorMiddleware.test.ts
└── services/              # Service layer unit tests
    ├── AccountService.test.ts
    ├── AuthService.test.ts
    ├── CategoryService.test.ts
    ├── TransactionService.test.ts
    └── UserService.test.ts
```

**Naming convention:** `[OriginalFileName].test.ts`

**Test discovery pattern:** `**/__tests__/**/*.test.ts` (configured in `jest.config.js`)

## What Is Tested

| Type                  | What is tested                                                                         | Files                     |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------- |
| **Entity tests**      | Constructor, property assignment, default values, null coalescing                      | `entities/*.test.ts`      |
| **Service tests**     | Business logic, ownership checks, error throwing, CRUD operations, balance adjustments | `services/*.test.ts`      |
| **Middleware tests**  | Error classification, status code mapping, response format                             | `middleware/*.test.ts`    |
| **Integration tests** | Full HTTP request/response cycle through the Express app                               | `integration/api.test.ts` |

## What Is NOT Tested (and Why)

- **Repository implementations** — These are thin wrappers around Sequelize/Mongoose. Testing them requires a real database, which is integration testing territory
- **Route definitions** — Routes are wired declaratively; their behavior is tested through integration tests
- **Controllers** — Controllers are thin; their logic is covered by service + integration tests
- **Config files** — Static configuration, not behavioral code

## Writing a New Test

### Critical: Mock `shared/constants` First

The `shared/constants.ts` module eagerly parses environment variables at import time using Zod. **Every test file must mock this module before importing any source code:**

```typescript
jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "SEQ",
    JWT_SECRET: "test",
    BCRYPT_SALT_ROUNDS: 12,
    JWT_EXPIRATION: "24h",
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
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
  DB_TYPES: { SEQ: "SEQ", MONGO: "MONGO", LOCAL_STORAGE: "LOCAL_STORAGE" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
  },
  MODEL_NAMES: {
    USER: "User",
    ACCOUNT: "Account",
    TRANSACTION: "Transaction",
    BUDGET: "Budget",
    CATEGORY: "Category",
  },
}));
```

### Service Test Pattern

```typescript
// 1. Mock constants (MUST be first — see above)
jest.mock("../../shared/constants", () => ({ ... }));

// 2. Import source code AFTER mocks
import { AccountService } from "../../app/services/AccountService";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { Account } from "../../domain/entities/Account";
import { ApiError } from "../../shared/errors";

// 3. Create mock repository factory
const createMockRepo = (): jest.Mocked<IAccountRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

// 4. Test suite
describe("AccountService", () => {
  let service: AccountService;
  let repo: jest.Mocked<IAccountRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new AccountService(repo);
  });

  describe("getAccountById", () => {
    it("should return account when found and owned by user", async () => {
      const account = new Account({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        name: "Savings",
        type: "SAVINGS",
        balance: 1000,
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      });
      repo.getById.mockResolvedValue(account);

      const result = await service.getAccountById(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      expect(repo.getById).toHaveBeenCalledWith("019576a0-d7b6-7d6d-af6a-2b7545f5ac71");
      expect(result.name).toBe("Savings");
    });

    it("should throw NotFound when account does not exist", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(
        service.getAccountById("nonexistent-id", "user-id"),
      ).rejects.toThrow(ApiError);
    });

    it("should throw Forbidden when user does not own the account", async () => {
      const account = new Account({
        id: "account-id",
        name: "Other",
        type: "CASH",
        userId: "other-user-id",
      });
      repo.getById.mockResolvedValue(account);

      await expect(
        service.getAccountById("account-id", "my-user-id"),
      ).rejects.toThrow("Access denied");
    });
  });
});
```

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

```typescript
const createMockRepo = (): jest.Mocked<IAccountRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});
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

<!-- TODO: requires human input — No minimum coverage threshold is currently configured in jest.config.js -->

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
  transform: {
    "^.+\\.ts$": ["ts-jest", { diagnostics: false }],
  },
};
```

Key settings:

- `clearMocks: true` — Automatically clears mock state between tests
- `diagnostics: false` — Suppresses TypeScript diagnostics in tests for speed
- `forceExit` and `detectOpenHandles` — Set in npm scripts, not config
