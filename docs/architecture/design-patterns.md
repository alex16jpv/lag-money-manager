# Design Patterns

## 1. Repository Pattern

### Why it is used

Decouples business logic from data access. The service layer works with repository interfaces, unaware of whether data comes from MySQL (Sequelize) or MongoDB (Mongoose). This enables swapping database backends at runtime via the `DB_TYPE` environment variable.

### Where it is implemented

| File                                                          | Role                      |
| ------------------------------------------------------------- | ------------------------- |
| `src/domain/repositories/IRepository.ts`                      | Generic base interface    |
| `src/domain/repositories/[entity]/I[Entity]Repository.ts`     | Entity-specific interface |
| `src/domain/repositories/[entity]/[Entity]SeqRepository.ts`   | Sequelize implementation  |
| `src/domain/repositories/[entity]/[Entity]MongoRepository.ts` | Mongoose implementation   |

### Code example

**Generic interface** (`src/domain/repositories/IRepository.ts`):

```typescript
import { PaginatedResult, PaginationParams } from "../../shared/pagination";

export interface IRepository<T> {
  getById(id: string): Promise<T | null>;
  getAll(pagination: PaginationParams): Promise<PaginatedResult<T>>;
  create(entity: T): Promise<T>;
  update(id: string, entity: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}
```

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
  ) {}
  // ... service methods use this.transactionRepo and this.accountRepo
}
```

### Rules for extending

- Every new entity needs: `I[Entity]Repository.ts`, `[Entity]SeqRepository.ts`, `[Entity]MongoRepository.ts`
- Entity-specific interfaces must extend `IRepository<T>`
- If the entity is user-scoped, add `getAllByUserId()` to the interface
- Repository implementations must map DB records to domain entities (never return raw ORM objects)
- Throw `ApiError("NotFound", ...)` when update/delete targets don't exist

---

## 2. Factory + Provider Pattern

### Why it is used

Centralizes repository creation and supports runtime selection of the database backend. The factory uses lazy caching to avoid creating repository instances until they're needed, and each database backend registers its own set of repository creators via a provider function.

### Where it is implemented

| File                                               | Role                                         |
| -------------------------------------------------- | -------------------------------------------- |
| `src/app/factories/RepositoryFactory.ts`           | Central factory with cache and typed getters |
| `src/app/factories/providers/sequelizeProvider.ts` | Registers Sequelize repository creators      |
| `src/app/factories/providers/mongoProvider.ts`     | Registers Mongoose repository creators       |

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

**Provider** (`src/app/factories/providers/sequelizeProvider.ts`):

```typescript
export function registerRepositories(factory: RegistryTarget): void {
  loadSequelizeModels();
  factory.register("user", () => new UserSeqRepository());
  factory.register("account", () => new AccountSeqRepository());
  factory.register("category", () => new CategorySeqRepository());
  factory.register("transaction", () => new TransactionSeqRepository());
}
```

### Rules for extending

- To add a new entity: register its repository in **both** `sequelizeProvider.ts` and `mongoProvider.ts`
- Add a typed getter method in `RepositoryFactory` (e.g., `getBudgetRepository()`)
- Add the key to `REPO_KEYS` constant
- To add a new database backend: create a new provider file and call `RepositoryFactory.registerProvider()`

---

## 3. Middleware Pattern

### Why it is used

Separates cross-cutting concerns (security, authentication, request tracking, validation, error handling) from business logic. Express middleware chain ensures consistent processing order for every request.

### Where it is implemented

| File                                    | Middleware                            | Scope                   |
| --------------------------------------- | ------------------------------------- | ----------------------- |
| `src/shared/requestId.ts`               | Request correlation ID                | Global (all requests)   |
| `src/app.ts`                            | Helmet, CORS, rate limit, body parser | Global (all requests)   |
| `src/app/middlewares/authMiddleware.ts` | JWT authentication                    | Protected routes only   |
| `src/app/validation/validate.ts`        | Zod schema validation                 | Per-route               |
| `src/shared/middlewares.ts`             | Global error handler                  | Global (error catching) |

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
    const decoded = jwt.verify(token, ENVIRONMENT.JWT_SECRET) as AuthPayload;
    req.user = decoded;
    next();
  } catch {
    throw new ApiError("Unauthorized", "Invalid or expired token");
  }
};
```

**Validation middleware factory** (`src/app/validation/validate.ts`):

```typescript
export const validate =
  (schema: z.ZodObject<z.ZodRawShape>) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      schema.parse({ body: req.body, query: req.query, params: req.params });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const details = error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        _res
          .status(400)
          .json({
            error: "ValidationError",
            message: "Invalid request data",
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

| File                             | DTOs                                                |
| -------------------------------- | --------------------------------------------------- |
| `src/app/dtos/UserDTO.ts`        | `CreateUserDTO`, `UpdateUserDTO`, `UserResponseDTO` |
| `src/app/dtos/AccountDTO.ts`     | `CreateAccountDTO`, `UpdateAccountDTO`              |
| `src/app/dtos/CategoryDTO.ts`    | `CreateCategoryDTO`, `UpdateCategoryDTO`            |
| `src/app/dtos/TransactionDTO.ts` | `CreateTransactionDTO`, `UpdateTransactionDTO`      |

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
  tags?: string | null;
  note?: string | null;
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

Encapsulates business object structure in plain TypeScript classes. Entities are framework-agnostic — no Sequelize or Mongoose dependencies. Both repository implementations map their database records to these entities before returning.

### Where it is implemented

| File                                 | Entity        |
| ------------------------------------ | ------------- |
| `src/domain/entities/User.ts`        | `User`        |
| `src/domain/entities/Account.ts`     | `Account`     |
| `src/domain/entities/Category.ts`    | `Category`    |
| `src/domain/entities/Transaction.ts` | `Transaction` |

### Code example

```typescript
// src/domain/entities/Account.ts
export interface AccountProps {
  id?: string;
  name: string;
  type: AccountType;
  balance?: number;
  userId: string;
}

export class Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  userId: string;

  constructor({ id, name, type, balance, userId }: AccountProps) {
    this.id = id!;
    this.name = name;
    this.type = type;
    this.balance = balance ?? 0;
    this.userId = userId;
  }
}
```

### Rules for extending

- One file per entity in `src/domain/entities/`
- Define a `[Entity]Props` interface for the constructor
- Use `??` (null coalescing) for optional fields with defaults
- Do not add framework-specific decorators or annotations
- Do not add methods that depend on external services
