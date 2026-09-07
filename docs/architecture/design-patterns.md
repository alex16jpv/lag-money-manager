# Design Patterns

## 1. Repository Pattern

### Why it is used

Decouples business logic from data access. Services depend only on the interfaces in `src/domain/`, so they can be unit-tested against fakes and never see a Mongoose document. MongoDB is the only backend (see ADR-001), so there is exactly one implementation per interface; the seam earns its keep in testing, not in portability.

### Where it is implemented

| File                                                             | Role                          |
| ---------------------------------------------------------------- | ----------------------------- |
| `src/domain/repositories/IRepository.ts`                         | Generic base interface        |
| `src/domain/repositories/[entity]/I[Entity]Repository.ts`        | Entity-specific interface     |
| `src/infrastructure/repositories/[entity]/[Entity]Repository.ts` | Mongoose implementation       |
| `src/infrastructure/models/[Entity]Model.ts`                     | The Mongoose schema behind it |

### Code example

**Generic interface** (`src/domain/repositories/IRepository.ts`):

```typescript
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { TxSession } from "../../shared/unitOfWork";

export interface IRepository<T> {
  getById(id: string, session?: TxSession): Promise<T | null>;
  getAll(pagination: PaginationParams): Promise<PaginatedResult<T>>;
  create(entity: Partial<T>, session?: TxSession): Promise<T>;
  update(id: string, entity: Partial<T>, session?: TxSession): Promise<T>;
  delete(id: string, session?: TxSession): Promise<void>;
}
```

The optional `session` is how a service enlists a write in a MongoDB transaction — see the Unit of Work pattern below.

**Entity-specific interface** (`src/domain/repositories/transaction/ITransactionRepository.ts`):

```typescript
export interface ITransactionRepository extends IRepository<Transaction> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>>;
}
```

**Service using the interface** (`src/app/services/TransactionService.ts`):

```typescript
export class TransactionService {
  constructor(
    private transactionRepo: ITransactionRepository,
    private accountRepo: IAccountRepository,
    private idempotencyRepo: IIdempotencyRepository,
    private categoryRepo: ICategoryRepository,
  ) {}
  // ... service methods use the injected repositories
}
```

### Rules for extending

- Every new entity needs: `src/domain/repositories/[entity]/I[Entity]Repository.ts` and `src/infrastructure/repositories/[entity]/[Entity]Repository.ts`
- Entity-specific interfaces must extend `IRepository<T>`
- If the entity is user-scoped, add `getAllByUserId()` to the interface
- Repository implementations must map documents to domain entities (never return raw Mongoose docs) and convert money between integer cents and decimals at that boundary
- Accept an optional `session?: TxSession` on any method a transactional flow might call
- Throw `ApiError("NotFound", ...)` when update/delete targets don't exist

---

## 2. Factory + Provider Pattern

### Why it is used

Centralizes repository creation behind one lazily-cached registry, so controllers wire services from a single place instead of `new`-ing concrete repositories. A provider function registers the creators under a `DB_TYPE` key; only `MONGO` is registered today, and `DB_TYPES` in `src/shared/constants.ts` declares no other value.

### Where it is implemented

| File                                           | Role                                         |
| ---------------------------------------------- | -------------------------------------------- |
| `src/app/factories/RepositoryFactory.ts`       | Central factory with cache and typed getters |
| `src/app/factories/providers/mongoProvider.ts` | Registers the Mongoose repository creators   |

### Code example

**Factory** (`src/app/factories/RepositoryFactory.ts`):

```typescript
export class RepositoryFactory {
  private static providers = new Map<string, DbProvider>();
  private cache = new Map<string, unknown>();
  private creators = new Map<string, () => unknown>();

  static registerProvider(dbType: string, provider: DbProvider): void {
    RepositoryFactory.providers.set(dbType, provider);
  }

  constructor() {
    const provider = RepositoryFactory.providers.get(dbType);
    if (!provider) {
      throw new Error(`No database provider registered for DB_TYPE: ${dbType}`);
    }
    provider(this);
  }

  private getRepository<T>(key: string): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const creator = this.creators.get(key);
    if (!creator) throw new Error(`No repository registered for key: ${key}`);
    const repo = creator() as T;
    this.cache.set(key, repo);
    return repo;
  }

  getUserRepository(): IUserRepository {
    return this.getRepository<IUserRepository>(REPO_KEYS.USER);
  }
  getAccountRepository(): IAccountRepository {
    return this.getRepository<IAccountRepository>(REPO_KEYS.ACCOUNT);
  }
  // ...
}
```

**Provider** (`src/app/factories/providers/mongoProvider.ts`):

```typescript
export const dbType = DB_TYPES.MONGO;

export function registerRepositories(factory: RegistryTarget): void {
  connectMongo().catch((err) => {
    logger.error({ err }, "Failed to connect to MongoDB");
    // Fail fast in a long-lived server; in Lambda, exiting poisons the runtime.
    if (!IS_LAMBDA) {
      process.exit(1);
    }
  });
  factory.register("user", () => new UserRepository());
  factory.register("account", () => new AccountRepository());
  factory.register("category", () => new CategoryRepository());
  factory.register("transaction", () => new TransactionRepository());
  factory.register("idempotency", () => new IdempotencyRepository());
  factory.register("budget", () => new BudgetRepository());
  factory.register("refreshSession", () => new RefreshSessionRepository());
}
```

### Rules for extending

- To add a new entity: register its repository in `mongoProvider.ts`
- Add a typed getter method in `RepositoryFactory` (e.g., `getBudgetRepository()`)
- Add the key to the `REPO_KEYS` constant

---

## 3. Middleware Pattern

### Why it is used

Separates cross-cutting concerns (security, authentication, request tracking, validation, error handling) from business logic. Express middleware chain ensures consistent processing order for every request.

### Where it is implemented

| File                                             | Middleware                              | Scope                         |
| ------------------------------------------------ | --------------------------------------- | ----------------------------- |
| `src/shared/requestId.ts`                        | Request correlation ID                  | Global (all requests)         |
| `src/app/middlewares/requestLogMiddleware.ts`    | One completion log line per request     | Global (all requests)         |
| `src/app.ts`                                     | Helmet, compression, CORS, body parser  | Global (all requests)         |
| `src/app/middlewares/gatewaySecretMiddleware.ts` | `x-api-secret` front-door check         | Everything below the probes   |
| `src/app/middlewares/dbReadinessMiddleware.ts`   | Ensures the Mongo connection is up      | Everything after `/health/db` |
| `src/app/middlewares/authRateLimitMiddleware.ts` | Mongo-backed per-key auth rate limiting | `/auth` routes                |
| `src/app/middlewares/authMiddleware.ts`          | JWT authentication                      | Protected routes only         |
| `src/app/validation/validate.ts`                 | Zod schema validation                   | Per-route                     |
| `src/shared/middlewares.ts`                      | Global error handler                    | Global (error catching)       |

### Code example

**Auth middleware** (`src/app/middlewares/authMiddleware.ts`):

```typescript
export const authMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(
      "Unauthorized",
      "Missing or invalid authorization header",
    );
  }
  const token = authHeader.split(" ")[1];
  try {
    // Pinning the algorithm blocks the "alg: none" / algorithm-confusion class.
    const decoded = jwt.verify(token, ENVIRONMENT.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    if (!isAuthPayload(decoded)) {
      throw new ApiError("Unauthorized", "Invalid token payload");
    }
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("Unauthorized", "Invalid or expired token");
  }
};
```

**Validation middleware factory** (`src/app/validation/validate.ts`):

```typescript
export const validate =
  (schema: z.ZodType) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as ParsedRequest;

      // Use the parsed (whitelisted) values so undeclared fields can't reach
      // services/models (mass-assignment guard). req.query is read-only in Express 5.
      if (parsed.body !== undefined) {
        req.body = parsed.body;
      }
      if (parsed.params !== undefined) {
        req.params = parsed.params as Request["params"];
      }

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        _res.status(400).json({
          error: "ValidationError",
          message: "Invalid request data",
          code: "VALIDATION",
          details,
        });
        return;
      }
      next(error);
    }
  };
```

### Rules for extending

- Global middleware: add to `src/app.ts` in the appropriate position in the chain
- Auth-related middleware: add to `src/app/middlewares/`
- Per-route validation: add Zod schemas to `src/app/validation/schemas.ts` and use `validate()` in route definitions
- Error types: handle new error types in `src/shared/middlewares.ts`

---

## 4. DTO Pattern

### Why it is used

Defines clear contracts for data flowing into and out of services. Separates the external API shape from internal domain entities. Prevents leaking internal fields (like passwords) to API responses.

### Where it is implemented

| File                             | DTOs                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| `src/app/dtos/UserDTO.ts`        | `CreateUserDTO`, `UpdateUserDTO`, `UserResponseDTO`                      |
| `src/app/dtos/AccountDTO.ts`     | `CreateAccountDTO`, `UpdateAccountDTO`                                   |
| `src/app/dtos/CategoryDTO.ts`    | `CreateCategoryDTO`, `UpdateCategoryDTO`                                 |
| `src/app/dtos/TransactionDTO.ts` | `CreateTransactionDTO`, `UpdateTransactionDTO`, `QuickAddTransactionDTO` |
| `src/app/dtos/BudgetDTO.ts`      | `CreateBudgetDTO`, `UpdateBudgetDTO`                                     |

### Code example

```typescript
// src/app/dtos/TransactionDTO.ts
export interface CreateTransactionDTO {
  type: TransactionType;
  amount: number;
  date: Date;
  categoryId?: string | null;
  description?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  userId: string;
  tags?: string[];
  note?: string | null;
  pendingDetails?: boolean;
  // Server-derived (quick-add sets QUICK); the schema never accepts it.
  source?: TransactionSource;
}

export interface UpdateTransactionDTO {
  id?: string;
  type?: TransactionType;
  amount?: number;
  date?: Date;
  // ... all optional fields
}
```

### Rules for extending

- One DTO file per module in `src/app/dtos/`
- `Create[Entity]DTO`: all required fields for creation, plus `userId`
- `Update[Entity]DTO`: `id?` plus all updateable fields as optional
- If sensitive data must be excluded from responses, create a `[Entity]ResponseDTO` (as in `UserResponseDTO`)

---

## 5. Domain Entity Pattern

### Why it is used

Encapsulates business object structure in plain TypeScript classes. Entities are framework-agnostic — no Mongoose dependency. Repositories map documents to these entities before returning, so nothing above `src/infrastructure/` ever holds a raw document. Entity fields carry **decimal** money; the cents conversion happens in the repository.

### Where it is implemented

| File                                 | Entity        |
| ------------------------------------ | ------------- |
| `src/domain/entities/User.ts`        | `User`        |
| `src/domain/entities/Account.ts`     | `Account`     |
| `src/domain/entities/Category.ts`    | `Category`    |
| `src/domain/entities/Transaction.ts` | `Transaction` |
| `src/domain/entities/Budget.ts`      | `Budget`      |

### Code example

```typescript
// src/domain/entities/Account.ts
export interface AccountProps {
  id?: string;
  name: string;
  type: AccountType;
  balance?: number;
  userId: string;
  isDefault?: boolean;
  // ISO 4217; stamped by the server from the owner's currency at creation.
  currency?: string;
  archivedAt?: Date | null;
}

export class Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  userId: string;
  isDefault: boolean;
  currency?: string;
  archivedAt: Date | null;

  constructor({
    id,
    name,
    type,
    balance,
    userId,
    isDefault,
    currency,
    archivedAt,
  }: AccountProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.type = type;
    this.balance = balance ?? 0;
    this.userId = userId;
    this.isDefault = isDefault ?? false;
    this.currency = currency;
    this.archivedAt = archivedAt ?? null;
  }
}
```

Entities that own invariants expose an `assertValid()` the service calls on create and on the update merge — `Transaction.assertValid()` rejects a non-positive amount, an amount over `MAX_AMOUNT` and a far-future date — throwing `DomainValidationError`, which the error middleware turns into a 400.

### Rules for extending

- One file per entity in `src/domain/entities/`
- Define a `[Entity]Props` interface for the constructor
- Generate the id with `uuidv7()` when the caller doesn't supply one
- Use `??` (null coalescing) for optional fields with defaults
- Do not add framework-specific decorators or annotations
- Do not add methods that depend on external services — invariant checks (`assertValid()`) are fine because they need nothing but the entity itself

---

## 6. Unit of Work

### Why it is used

A single API call can touch several documents that must move together — creating a transaction writes the transaction, `$inc`s one or two account balances, and records the idempotency key. MongoDB multi-document transactions make that atomic; without them a crash mid-flight leaves a balance that disagrees with the ledger. This is the capability that made the single-backend decision in ADR-001 worth taking.

### Where it is implemented

| File                                     | Role                                                         |
| ---------------------------------------- | ------------------------------------------------------------ |
| `src/shared/unitOfWork.ts`               | `withTransaction(fn)` — starts a session, commits, cleans up |
| `src/app/services/TransactionService.ts` | The main consumer (create, update, delete)                   |

### Code example

```typescript
// src/app/services/TransactionService.ts
return await withTransaction(async (session) => {
  await this.adjustBalances(transaction, 1, session);
  const created = await this.transactionRepo.create(transaction, session);
  if (idempotency) {
    await this.idempotencyRepo.record(/* ... */, session);
  }
  return created;
});
```

### Rules for extending

- Requires a replica set. Local development uses the single-node `rs0` from `docker-compose.yml`; `MONGO_URI` needs `directConnection=true` to talk to it
- The callback may be retried on a transient conflict, so it must be idempotent — do not put non-database side effects (emails, external calls) inside it
- Every write in the callback must forward the `session`; one that forgets silently escapes the transaction
- Throwing inside the callback aborts the whole unit — that is how `adjustBalances` refuses to let a missed `$inc` desync a balance
