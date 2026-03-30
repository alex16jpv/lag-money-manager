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
      throw new ApiError("Forbidden", "Access denied");
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
// BAD — returning Sequelize model instance
async getById(id: string): Promise<AccountModel | null> {
  return await this.model.findByPk(id);
}
```

**Why it is wrong:**
Leaks ORM internals (Sequelize metadata, methods) to the service layer. Couples services to a specific database implementation.

**Correct alternative:**

```typescript
// GOOD — map to domain entity before returning
async getById(id: string): Promise<Account | null> {
  const result = await this.model.findByPk(id);
  if (!result) return null;
  return new Account(result.toJSON());
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

**Why it is wrong:**
Allows users to access other users' data. Insecure Direct Object Reference (IDOR) vulnerability.

**Correct alternative:**

```typescript
// GOOD — verify ownership
async getAccountById(id: string, userId: string): Promise<Account> {
  const account = await this.repo.getById(id);
  if (!account) throw new ApiError("NotFound", "Account not found");
  if (account.userId !== userId) throw new ApiError("Forbidden", "Access denied");
  return account;
}
```

---

## 8. Importing Services from Repositories

**What it looks like:**

```typescript
// BAD — repository importing from service layer
import { AccountService } from "../../app/services/AccountService";

export class TransactionSeqRepository implements ITransactionRepository {
  async create(transaction: Partial<Transaction>): Promise<Transaction> {
    const accountService = new AccountService(...);
    // ... balance adjustment in repository
  }
}
```

**Why it is wrong:**
Violates dependency direction. Repositories are a lower layer and must not depend on services. Creates circular dependencies.

**Correct alternative:**
Balance adjustments belong in the service layer. The service orchestrates calls to multiple repositories.

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
async create(transaction: Partial<Transaction>): Promise<Transaction> {
  const result = await this.model.create(transaction);
  return new Transaction(result.toJSON());
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

## 11. Using FLOAT for Financial Amounts

**What it looks like:**

```typescript
// BAD — floating point for money
amount: { type: DataTypes.FLOAT, allowNull: false }
```

**Why it is wrong:**
Floating-point arithmetic causes rounding errors (e.g., `0.1 + 0.2 !== 0.3`). This leads to balance discrepancies over time.

**Correct alternative:**

```typescript
// GOOD — DECIMAL with fixed precision
amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false }
```

---

## 12. Leaving Dead Code or TODO Comments

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
