# Anti-Patterns

Explicit list of things that must never be done in this project. Each entry includes a bad example, why it's wrong, and the correct alternative.

---

## 1. Calling Repositories from Controllers

**What it looks like:**

```typescript
// BAD — controller accessing repository directly
export class AccountController {
  static getAccountById = async (req: Request, res: Response) => {
    const account = await repositoryFactory
      .getAccountRepository()
      .getById(req.params.id);
    if (account.userId !== req.user!.userId) {
      throw new ApiError("NotFound", "Account not found");
    }
    res.status(200).json(account);
  };
}
```

**Why it is wrong:**
Bypasses the service layer. Business logic (ownership checks, data transformations) is now in the controller, creating duplication and making it untestable without HTTP context.

**Correct alternative:**

```typescript
// GOOD — controller delegates to service
export class AccountController {
  static getAccountById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const account = await accountService.getAccountById(
      req.params.id as string,
      userId,
    );
    res.status(200).json(account);
  };
}
```

---

## 2. Business Logic in Route Handlers

**What it looks like:**

```typescript
// BAD — business logic in route definition
router.post("/", validate(createAccountSchema), async (req, res) => {
  const account = new Account({ ...req.body, userId: req.user!.userId });
  const result = await repositoryFactory.getAccountRepository().create(account);
  res.status(201).json(result);
});
```

**Why it is wrong:**
Routes should only wire middleware, validation, and controller methods. Inline business logic can't be unit tested and violates separation of concerns.

**Correct alternative:**

```typescript
// GOOD — route wires validation and controller
router.post(
  "/",
  validate(createAccountSchema),
  AccountController.createAccount,
);
```

---

## 3. Returning Raw Database Objects

**What it looks like:**

```typescript
// BAD — returning the Mongoose document
async getById(id: string): Promise<IAccountDocument | null> {
  return await AccountModel.findById(id);
}
```

**Why it is wrong:**
Leaks ODM internals (`_id`, `__v`, document methods) to the service layer, and hands the service raw **integer cents** where it expects a decimal amount. Couples every caller to the storage shape.

**Correct alternative:**

```typescript
// GOOD — map to domain entity before returning
async getById(id: string): Promise<Account | null> {
  const doc = await AccountModel.findOne({ _id: id, archivedAt: null }).lean();
  if (!doc) return null;
  return this.toEntity(doc); // maps _id → id and fromCents(balance)
}
```

---

## 4. Returning Passwords in API Responses

**What it looks like:**

```typescript
// BAD — returning full user object including password
async register(dto: CreateUserDTO): Promise<User> {
  const user = new User({ ...dto, password: hashedPassword });
  return await this.repo.create(user);
}
```

**Why it is wrong:**
Exposes hashed passwords to API consumers. Security vulnerability.

**Correct alternative:**

```typescript
// GOOD — strip password before returning
async register(dto: CreateUserDTO): Promise<UserResponseDTO> {
  const created = await this.repo.create(user);
  const { password: _, ...userWithoutPassword } = created as User & { password?: string };
  return userWithoutPassword as UserResponseDTO;
}
```

---

## 5. Hardcoding Configuration Values

**What it looks like:**

```typescript
// BAD — hardcoded values
const token = jwt.sign(payload, "my-secret-key", { expiresIn: "24h" });
const bcryptRounds = 12;
```

**Why it is wrong:**
Makes configuration impossible to change without code changes. Secrets in source code are a security risk.

**Correct alternative:**

```typescript
// GOOD — use environment variables via ENVIRONMENT constant
const token = jwt.sign(payload, ENVIRONMENT.JWT_SECRET, {
  expiresIn: ENVIRONMENT.JWT_EXPIRATION,
});
const hashedPassword = await bcryptjs.hash(
  password,
  ENVIRONMENT.BCRYPT_SALT_ROUNDS,
);
```

---

## 6. Skipping Validation on Endpoints

**What it looks like:**

```typescript
// BAD — no validation middleware
router.post("/", TransactionController.createTransaction);
```

**Why it is wrong:**
Invalid data reaches the service/database layer, causing cryptic errors or data corruption. All input must be validated at the boundary.

**Correct alternative:**

```typescript
// GOOD — validate before controller
router.post(
  "/",
  validate(createTransactionSchema),
  TransactionController.createTransaction,
);
```

---

## 7. Skipping Ownership Checks

**What it looks like:**

```typescript
// BAD — no ownership verification
async getAccountById(id: string): Promise<Account> {
  const account = await this.repo.getById(id);
  if (!account) throw new ApiError("NotFound", "Account not found");
  return account;  // Any user can access any account!
}
```

Equally wrong, more subtly:

```typescript
// BAD — leaks existence
if (account.userId !== userId) throw new ApiError("Forbidden", "Access denied");
```

**Why it is wrong:**
The first allows users to read other users' data — an Insecure Direct Object Reference (IDOR). The second fixes the read but still answers "does this id exist?", letting an attacker enumerate ids by watching 403 versus 404.

**Correct alternative:**

```typescript
// GOOD — missing and foreign are indistinguishable from the outside
async getAccountById(id: string, userId: string): Promise<Account> {
  const account = await this.repo.getByIdIncludingArchived(id);
  if (!account || account.userId !== userId) {
    throw new ApiError("NotFound", "Account not found");
  }
  return account;
}
```

`ApiError("Forbidden", ...)` is reserved for the gateway-secret middleware. Ownership failures are always 404.

---

## 8. Importing Services from Repositories

**What it looks like:**

```typescript
// BAD — repository importing from service layer
import { AccountService } from "../../app/services/AccountService";

export class TransactionRepository implements ITransactionRepository {
  async create(transaction: Partial<Transaction>): Promise<Transaction> {
    const accountService = new AccountService(...);
    // ... balance adjustment in repository
  }
}
```

**Why it is wrong:**
Violates dependency direction. Repositories are a lower layer and must not depend on services. Creates circular dependencies.

**Correct alternative:**
Balance adjustments belong in the service layer. `TransactionService` orchestrates the transaction repository and the account repository inside one `withTransaction()` unit of work, forwarding the same session to both.

---

## 9. Using `any` Type

**What it looks like:**

```typescript
// BAD — losing type safety
async create(data: any): Promise<any> {
  return await this.model.create(data);
}
```

**Why it is wrong:**
Defeats the purpose of TypeScript. Hides bugs that the compiler would catch.

**Correct alternative:**

```typescript
// GOOD — typed parameters and return
async create(
  transaction: Partial<Transaction>,
  session?: TxSession,
): Promise<Transaction> {
  const id = transaction.id ?? uuidv7();
  const [doc] = await TransactionModel.create(
    [{ _id: id, ...this.toStorage(transaction) }],
    { session: session ?? undefined },
  );
  return this.toEntity(doc.toObject());
}
```

---

## 10. Modifying Shared Utilities Without Checking Consumers

**What it looks like:**

```typescript
// BAD — changing pagination signature without updating all callers
export function extractPagination(req: Request): {
  page: number;
  perPage: number;
} {
  // Changed interface — all controllers now break
}
```

**Why it is wrong:**
Shared utilities are imported by multiple modules. Changing their interface without updating all consumers causes cascading failures.

**Correct alternative:**
Before modifying any file in `src/shared/`, search for all imports of the affected function/class and update them together. Run `npm test` to verify.

---

## 11. Storing Money as a Decimal

**What it looks like:**

```typescript
// BAD — persisting the decimal amount straight from the entity
const doc: Record<string, unknown> = { ...account }; // balance: 1234.56
await AccountModel.updateOne({ _id: id }, { $inc: { balance: delta } });
```

**Why it is wrong:**
Floating-point arithmetic accumulates error (`0.1 + 0.2 !== 0.3`). Because balances are updated with `$inc`, every transaction compounds that error into the stored balance until it no longer matches the ledger.

**Correct alternative:**
Money is persisted as **integer cents** and exposed as a decimal. Convert at the repository boundary — nowhere else.

```typescript
// GOOD — convert in toStorage()/toEntity()
private toStorage(account: Partial<Account>): Record<string, unknown> {
  const doc: Record<string, unknown> = { ...account };
  if (account.balance !== undefined) {
    doc.balance = toCents(account.balance);
  }
  return doc;
}
```

A service or controller that calls `toCents()`/`fromCents()` itself is a smell: it means a cents value escaped the repository, and now some other caller is about to double-convert it.

---

## 12. Branching on `error.message`

**What it looks like:**

```typescript
// BAD — client (or another service) parsing prose
if (body.message.includes("different currencies")) {
  showCurrencyHelp();
}
```

**Why it is wrong:**
`message` is human-facing copy. Rewording it — or translating it — silently breaks every consumer that matched on it, with no compile error and no failing test on the backend side. HTTP status is too coarse to help: `CATEGORY_ARCHIVED`, `FUTURE_DATE` and `CURRENCY_MISMATCH` are all 400.

**Correct alternative:**

```typescript
// GOOD — branch on the stable code
if (body.code === "CURRENCY_MISMATCH") {
  showCurrencyHelp();
}
```

If a case you need to distinguish has no `code`, add one at the throw site (third argument to `ApiError`) and document it — don't parse the message. See `error-handling.md`.

---

## 13. Multi-Document Writes Outside a Unit of Work

**What it looks like:**

```typescript
// BAD — three writes, no session; a crash between them corrupts the balance
await this.accountRepo.incrementBalance(fromAccountId, -amount);
const created = await this.transactionRepo.create(transaction);
await this.idempotencyRepo.record(userId, scope, key, created.id, hash);
```

**Why it is wrong:**
These writes are one logical operation. Interrupted halfway, the account balance no longer agrees with the sum of its transactions — and nothing in the system will ever notice. Forgetting to forward `session` to a single call inside an otherwise correct `withTransaction()` block is the same bug wearing a disguise: that write silently commits on its own.

**Correct alternative:**

```typescript
// GOOD — one atomic unit, session forwarded to every write
return await withTransaction(async (session) => {
  await this.adjustBalances(transaction, 1, session);
  const created = await this.transactionRepo.create(transaction, session);
  if (idempotency) {
    await this.idempotencyRepo.record(/* ... */, session);
  }
  return created;
});
```

The callback may be retried on a transient write conflict, so keep it idempotent and free of external side effects (emails, webhooks, HTTP calls).

---

## 14. Hard-Deleting Records

**What it looks like:**

```typescript
// BAD — the row is gone, and so is the audit trail
await TransactionModel.deleteOne({ _id: id });
```

**Why it is wrong:**
A deleted transaction still has to explain a past balance, and an accidental delete has to be recoverable. Removing the document destroys both.

**Correct alternative:**
Stamp a timestamp and filter it out of every read:

- **Soft delete** — transactions and users use `deletedAt`; every query carries `deletedAt: null`. Deleting a transaction also reverses its balance effect, inside the unit of work.
- **Archive** — accounts, categories and budgets use `archivedAt`; queries carry `archivedAt: null`, `?includeArchived=true` opts back in, and accounts and categories expose `POST /{id}/restore`.

A new query path that forgets the `deletedAt: null` / `archivedAt: null` filter will happily return records the user believes are gone.

---

## 15. Leaving Dead Code or TODO Comments

**What it looks like:**

```typescript
// BAD
// async getBudgetBalance() {
//   // TODO: implement this later
// }
```

**Why it is wrong:**
Clutters the codebase, confuses other developers and AI agents, and may contain outdated logic that gets accidentally uncommented.

**Correct alternative:**
Remove dead code. Track unimplemented features in an issue tracker, not in comments. If a TODO is genuinely needed for an in-progress feature, make it actionable with a clear description and reference an issue number.
