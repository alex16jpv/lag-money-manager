# Transactions Module

## What This Module Does

The most complex module in the system. Records financial transactions (income, expenses, transfers) and automatically adjusts account balances. Supports three transaction types:

- **INCOME**: Money flowing into `toAccountId` (balance increases)
- **EXPENSE**: Money flowing out of `fromAccountId` (balance decreases)
- **TRANSFER**: Money moving from `fromAccountId` to `toAccountId` (one decreases, other increases)

On update or delete, the original balance adjustments are reversed before applying new ones. All transactions are user-scoped.

## Files and Responsibilities

| File                                                                | Role                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/app/routes/transactionRoutes.ts`                               | Route definitions with OpenAPI docs (full CRUD at `/transactions`)        |
| `src/app/controllers/TransactionController.ts`                      | Thin HTTP handler, delegates to TransactionService                        |
| `src/app/services/TransactionService.ts`                            | Business logic: balance adjustments, ownership checks, CRUD               |
| `src/app/dtos/TransactionDTO.ts`                                    | `CreateTransactionDTO`, `UpdateTransactionDTO`                            |
| `src/app/validation/schemas.ts`                                     | `createTransactionSchema`, `updateTransactionSchema` (with `superRefine`) |
| `src/domain/entities/Transaction.ts`                                | Transaction domain entity                                                 |
| `src/domain/repositories/transaction/ITransactionRepository.ts`     | Repository interface                                                      |
| `src/domain/repositories/transaction/TransactionSeqRepository.ts`   | Sequelize implementation                                                  |
| `src/domain/repositories/transaction/TransactionMongoRepository.ts` | Mongoose implementation                                                   |
| `src/domain/models/sequelize/TransactionModel.ts`                   | Sequelize model                                                           |
| `src/domain/models/mongoose/TransactionMongoModel.ts`               | Mongoose model                                                            |

## Public API

### `GET /transactions`

Get all transactions for the authenticated user (paginated, offset + cursor support).

### `POST /transactions`

Create a new transaction. Adjusts affected account balances.

**Request body:**

```json
{
  "type": "EXPENSE",
  "amount": 50.0,
  "date": "2026-03-29T12:00:00.000Z",
  "fromAccountId": "019576a0-...",
  "categoryId": "019576a0-...",
  "description": "Groceries",
  "tags": "food,weekly",
  "note": "Weekly shopping"
}
```

**Validation rules (via Zod `superRefine`):**

- `EXPENSE` requires `fromAccountId`
- `INCOME` requires `toAccountId`
- `TRANSFER` requires both `fromAccountId` and `toAccountId` (must be different)
- `amount` must be positive
- `date` must be valid ISO 8601

### `GET /transactions/:id`

Get a single transaction by ID. Ownership enforced.

### `PUT /transactions/:id`

Update a transaction. Reverses old balance adjustments, applies new ones.

### `DELETE /transactions/:id`

Delete a transaction. Reverses balance adjustments on affected accounts.

## Internal Flow

### Create Transaction

```mermaid
sequenceDiagram
    participant C as Client
    participant VAL as Validation (Zod superRefine)
    participant CTRL as TransactionController
    participant SVC as TransactionService
    participant TX_REPO as TransactionRepository
    participant ACCT_REPO as AccountRepository
    participant DB as Database

    C->>VAL: POST /transactions { type, amount, fromAccountId, ... }
    VAL->>VAL: Validate type-specific account requirements
    VAL->>CTRL: Validated body
    CTRL->>CTRL: Extract userId, merge into body
    CTRL->>SVC: createTransaction(dto)
    SVC->>SVC: new Transaction(dto)
    SVC->>SVC: adjustBalances(transaction, direction=+1)

    alt EXPENSE
        SVC->>ACCT_REPO: getById(fromAccountId)
        ACCT_REPO->>DB: SELECT
        DB->>ACCT_REPO: Account
        SVC->>ACCT_REPO: update(fromAccountId, { balance: balance - amount })
    end

    alt INCOME
        SVC->>ACCT_REPO: getById(toAccountId)
        ACCT_REPO->>DB: SELECT
        DB->>ACCT_REPO: Account
        SVC->>ACCT_REPO: update(toAccountId, { balance: balance + amount })
    end

    alt TRANSFER
        SVC->>ACCT_REPO: getById(fromAccountId)
        SVC->>ACCT_REPO: update(fromAccountId, { balance: balance - amount })
        SVC->>ACCT_REPO: getById(toAccountId)
        SVC->>ACCT_REPO: update(toAccountId, { balance: balance + amount })
    end

    SVC->>TX_REPO: create(transaction)
    TX_REPO->>DB: INSERT
    DB->>TX_REPO: Created record
    TX_REPO->>SVC: Transaction entity
    SVC->>CTRL: Transaction
    CTRL->>C: 201 + transaction JSON
```

### Update Transaction (Balance Reversal + Re-apply)

```mermaid
sequenceDiagram
    participant SVC as TransactionService
    participant ACCT as AccountRepository

    Note over SVC: 1. Fetch existing transaction
    Note over SVC: 2. Reverse old balances (direction = -1)
    SVC->>ACCT: adjustBalances(existing, -1)
    Note over SVC: 3. Create new Transaction entity with merged data
    Note over SVC: 4. Apply new balances (direction = +1)
    SVC->>ACCT: adjustBalances(updated, +1)
    Note over SVC: 5. Persist update to DB
```

## Dependencies

**Imports:**

- `domain/entities/Transaction` — Transaction entity
- `domain/repositories/transaction/ITransactionRepository` — Transaction data access
- `domain/repositories/account/IAccountRepository` — Account data access (for balance adjustments)
- `shared/errors` — `ApiError`
- `shared/pagination` — Pagination types

**Imported by:**

- Transaction routes in `src/app.ts`

**Cross-module dependency:** TransactionService depends on `IAccountRepository` to adjust account balances. This is the only service that depends on another module's repository.

## Environment Variables

None specific to this module.

## Error States

| Error             | Status | Condition                                        |
| ----------------- | ------ | ------------------------------------------------ |
| `NotFoundError`   | 404    | Transaction not found                            |
| `NotFoundError`   | 404    | Source account not found (on create/update)      |
| `NotFoundError`   | 404    | Destination account not found (on create/update) |
| `ForbiddenError`  | 403    | Transaction belongs to another user              |
| `ForbiddenError`  | 403    | Source account does not belong to the user       |
| `ForbiddenError`  | 403    | Destination account does not belong to the user  |
| `BadRequestError` | 400    | Transaction ID mismatch (body vs URL param)      |
| `ValidationError` | 400    | Missing required account for transaction type    |
| `ValidationError` | 400    | Same fromAccountId and toAccountId on TRANSFER   |

## Transaction Types

| Type       | Required Fields                | Balance Effect                                                 |
| ---------- | ------------------------------ | -------------------------------------------------------------- |
| `INCOME`   | `toAccountId`                  | `toAccount.balance += amount`                                  |
| `EXPENSE`  | `fromAccountId`                | `fromAccount.balance -= amount`                                |
| `TRANSFER` | `fromAccountId`, `toAccountId` | `fromAccount.balance -= amount`, `toAccount.balance += amount` |

## How to Extend

- To add recurring transactions: add `recurrence` field to entity/model, create a scheduler service
- To add budget tracking: uncomment the TODO in `createTransaction()` and implement `updateBudgetBalance()`
- To add transaction attachments: add a separate `TransactionAttachment` entity with a foreign key
- **Important:** Any new code that creates/modifies transactions must maintain the balance adjustment contract — always adjust account balances accordingly
