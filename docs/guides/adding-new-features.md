# Adding New Features

This guide covers how to add each type of component in the project. Follow the exact patterns described here to maintain consistency.

---

## New Module (Full Vertical Slice)

A full module consists of all layers from route to database. Create these files in order:

1. Domain entity — `src/domain/entities/`
2. DTOs — `src/app/dtos/`
3. Mongoose model — `src/infrastructure/models/`
4. Repository interface — `src/domain/repositories/[entity]/`
5. Repository implementation — `src/infrastructure/repositories/[entity]/`
6. Register it in `mongoProvider.ts` and `RepositoryFactory.ts`
7. Service — `src/app/services/`
8. Controller — `src/app/controllers/`
9. Validation schemas — `src/app/validation/schemas.ts`
10. Routes — `src/app/routes/`, then register them in `src/app.ts`
11. OpenAPI request body in `src/config/swagger.ts` (if the endpoints take a body)
12. Tests — `src/__tests__/`

Refer to the sections below for each file.

> **Layer rule:** `src/domain/` holds entities and repository *interfaces* and imports nothing from `app/` or `infrastructure/`. Mongoose models and the concrete repositories live in `src/infrastructure/`. Names carry no `Mongo` suffix — MongoDB is the only backend.

---

## New Domain Entity

**When:** You need to represent a new business object.

**File:** `src/domain/entities/[Entity].ts`

**Naming:** `PascalCase.ts` (e.g., `Budget.ts`)

**Boilerplate:**

```typescript
import { v7 as uuidv7 } from "uuid";

export interface [Entity]Props {
  id?: string;
  name: string;
  // ... entity-specific required fields
  userId: string;
  archivedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class [Entity] {
  id: string;
  name: string;
  userId: string;
  archivedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;

  constructor({ id, name, userId, archivedAt, createdAt, updatedAt }: [Entity]Props) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.userId = userId;
    this.archivedAt = archivedAt ?? null;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
```

**Other files to modify:** None (entities are standalone — they import only `uuid` and `src/shared/constants`).

**Checklist:**

- [ ] Props interface defined with optional `id`, `archivedAt`, `createdAt`, `updatedAt`
- [ ] `id` defaults to `uuidv7()` — the entity mints its own id, the database does not
- [ ] `createdAt`/`updatedAt` stay optional (`?: Date`); Mongoose fills them via `{ timestamps: true }`. Never `!`-assert them into existence
- [ ] Constructor uses `??` for optional fields
- [ ] Money fields are **decimals** on the entity; the integer-cents conversion belongs to the repository

---

## New DTO

**When:** You need input/output type contracts for a new module.

**File:** `src/app/dtos/[Entity]DTO.ts`

**Naming:** `PascalCase` with `DTO` suffix

**Boilerplate:**

```typescript
export interface Create[Entity]DTO {
  name: string;
  // ... required fields for creation
  userId: string;
}

export interface Update[Entity]DTO {
  id?: string;
  name?: string;
  // ... all updatable fields as optional
}
```

**Checklist:**

- [ ] `Create` DTO has all required fields plus `userId`
- [ ] `Update` DTO has optional `id` and all updatable fields as optional
- [ ] If response needs to exclude fields, add a `[Entity]ResponseDTO`

---

## New Mongoose Model

**When:** Adding a new entity that must be persisted.

**File:** `src/infrastructure/models/[Entity]Model.ts`

**Naming:** `PascalCase` with a `Model` suffix — no `Mongo` in the name.

**Boilerplate:**

```typescript
import mongoose, { Schema } from "mongoose";

import { MODEL_NAMES } from "../../shared/constants";

export interface I[Entity]Document {
  _id: string;
  name: string;
  amount: number; // integer cents
  userId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const [Entity]Schema = new Schema<I[Entity]Document>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    userId: { type: String, required: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Every query is user-scoped: index accordingly.
[Entity]Schema.index({ userId: 1, _id: 1 });

export const [Entity]Model = mongoose.model<I[Entity]Document>(
  MODEL_NAMES.[ENTITY],
  [Entity]Schema,
);
```

**Other files to modify:**

- `src/shared/constants.ts` — add the entity name to `MODEL_NAMES`
- `scripts/sync-indexes.ts` — add the model to the list, or its indexes will never be built in production (`autoIndex` is off there)

**Checklist:**

- [ ] Document interface with `_id` as a string (UUID v7, minted by the entity)
- [ ] Schema uses `{ timestamps: true }`
- [ ] Model name comes from `MODEL_NAMES`
- [ ] Money fields stored as **integer cents**, and the interface says so in a comment
- [ ] Indexes declared on the schema, prefixed by `userId` for user-scoped queries
- [ ] Uniqueness that must survive soft deletes uses a `partialFilterExpression` (see `AccountModel.ts`, `BudgetModel.ts`); case-insensitive uniqueness adds a `collation`
- [ ] Model added to `scripts/sync-indexes.ts`

---

## New Repository Interface

**When:** Adding data access for a new entity.

**File:** `src/domain/repositories/[entity]/I[Entity]Repository.ts`

**Create directory:** `src/domain/repositories/[entity]/`

**Boilerplate:**

```typescript
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import { [Entity] } from "../../entities/[Entity]";
import { IRepository } from "../IRepository";

export interface [Entity]Filters {
  ids?: string[];
  includeArchived?: boolean;
}

export interface I[Entity]Repository extends IRepository<[Entity]> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: [Entity]Filters,
  ): Promise<PaginatedResult<[Entity]>>;

  // Unlike getById, also resolves archived rows (read paths only).
  getByIdIncludingArchived(id: string): Promise<[Entity] | null>;

  countByUserId(userId: string): Promise<number>;
}
```

`IRepository<T>` already provides `getById`, `getAll`, `create`, `update` and `delete`, each accepting an optional `session?: TxSession` so the method can join a transaction.

**Checklist:**

- [ ] Extends `IRepository<T>`
- [ ] Adds `getAllByUserId()` if the entity is user-scoped
- [ ] Methods that can participate in a multi-document write accept `session?: TxSession`
- [ ] Each non-obvious method carries a one-line comment saying what it guarantees

---

## New Repository Implementation

**When:** Implementing data access for a new entity.

**File:** `src/infrastructure/repositories/[entity]/[Entity]Repository.ts` — no `Mongo` suffix.

**Boilerplate:** Follow `src/infrastructure/repositories/account/AccountRepository.ts`:

- Implement the entity-specific interface
- Private `toEntity(doc)` maps a document to a domain entity, converting cents to decimals with `fromCents`
- Private `toStorage(entity)` does the reverse with `toCents` before any write
- `create()` uses `entity.id ?? uuidv7()` for `_id`
- `.lean()` on every read
- Private `paginatedFind()` that applies the cursor (`_id: { $gt: cursor }`), sorts by `_id: 1`, runs the `find` and `countDocuments` in a `Promise.all`, and returns `buildPaginatedResult(...)`
- `delete()` is a **soft delete**: `findOneAndUpdate({ _id, archivedAt: null }, { archivedAt: new Date() })`
- Throw `ApiError("NotFound", ...)` from update/delete when nothing matched
- Pass `{ session: session ?? undefined }` through to every write

**Other files to modify:**

- `src/app/factories/providers/mongoProvider.ts` — register the new repository

**Checklist:**

- [ ] Implements `I[Entity]Repository`
- [ ] `toEntity()` / `toStorage()` mappers; no raw document ever leaves the repository
- [ ] UUID v7 generated for new documents
- [ ] `.lean()` used on reads
- [ ] Money converted with `toCents`/`fromCents` — this layer is the only place that knows about cents
- [ ] Soft delete via `archivedAt`, never `deleteOne`
- [ ] Registered in the Mongo provider

---

## Register in Repository Factory

**When:** After creating the repository implementation.

**Files to modify:**

1. `src/app/factories/RepositoryFactory.ts`:
   - Add a key to `REPO_KEYS`: `[ENTITY]: "[entity]"`
   - Add a typed getter: `get[Entity]Repository(): I[Entity]Repository`

2. `src/app/factories/providers/mongoProvider.ts`:
   - Add: `factory.register("[entity]", () => new [Entity]Repository());`

The factory caches one instance per key and is the only place repositories are constructed. Tests exploit this: they mock the factory module wholesale, which is why services must receive repositories through their constructor rather than reaching for the factory themselves.

---

## New Service

**When:** Adding business logic for a new entity.

**File:** `src/app/services/[Entity]Service.ts`

**Boilerplate:**

```typescript
import { [Entity] } from "../../domain/entities/[Entity]";
import {
  [Entity]Filters,
  I[Entity]Repository,
} from "../../domain/repositories/[entity]/I[Entity]Repository";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { Create[Entity]DTO, Update[Entity]DTO } from "../dtos/[Entity]DTO";

// Soft cap: protects the shared Atlas M0 tier from runaway creation.
const MAX_[ENTITIES]_PER_USER = 100;

export class [Entity]Service {
  constructor(private repo: I[Entity]Repository) {}

  async getAll[Entities](
    userId: string,
    pagination: PaginationParams,
    filters?: [Entity]Filters,
  ): Promise<PaginatedResult<[Entity]>> {
    return this.repo.getAllByUserId(userId, pagination, filters);
  }

  // Reads resolve archived rows too (archivedAt tells them apart);
  // only the listing hides them by default.
  async get[Entity]ById(id: string, userId: string): Promise<[Entity]> {
    const entity = await this.repo.getByIdIncludingArchived(id);
    // Someone else's id is a 404, not a 403: a 403 would confirm it exists.
    if (!entity || entity.userId !== userId) {
      throw new ApiError("NotFound", "[Entity] not found");
    }
    return new [Entity](entity);
  }

  async create[Entity](dto: Create[Entity]DTO): Promise<[Entity]> {
    if ((await this.repo.countByUserId(dto.userId)) >= MAX_[ENTITIES]_PER_USER) {
      throw new ApiError(
        "BadRequest",
        `[Entity] limit reached (${MAX_[ENTITIES]_PER_USER})`,
        "[ENTITY]_LIMIT_REACHED",
      );
    }
    return new [Entity](await this.repo.create(new [Entity](dto)));
  }

  async update[Entity](
    id: string,
    dto: Update[Entity]DTO,
    userId: string,
  ): Promise<[Entity]> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "[Entity] id does not match");
    }
    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "[Entity] not found");
    }
    if (existing.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "[Entity] is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }
    return new [Entity](await this.repo.update(id, dto));
  }

  async delete[Entity](id: string, userId: string): Promise<void> {
    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "[Entity] not found");
    }
    // Already archived: idempotent success, not a 404.
    if (existing.archivedAt) return;
    await this.repo.delete(id);
  }
}
```

Writes that touch more than one document (e.g. a transaction adjusting an account balance) wrap the whole thing in `withTransaction` from `src/shared/unitOfWork.ts` and pass the `session` down to every repository call. The callback is retried on transient conflicts, so it must be idempotent.

**Checklist:**

- [ ] Constructor receives repository **interfaces** (dependency injection) — never the factory, never a model
- [ ] Every user-scoped method verifies ownership, and reports a foreign id as `404`
- [ ] Errors are `ApiError` with a **stable `code`** where the client needs to branch
- [ ] Deleting something already archived is an idempotent success
- [ ] Returns domain entities (re-wrapped with `new [Entity](...)`), never raw documents
- [ ] Multi-document writes go through `withTransaction`
- [ ] No direct database access

---

## New Controller

**When:** Adding HTTP handlers for a new entity.

**File:** `src/app/controllers/[Entity]Controller.ts`

**Boilerplate:**

```typescript
import { Request, Response } from "express";
import { [Entity]Service } from "../services/[Entity]Service";
import repositoryFactory from "../factories/RepositoryFactory";
import { extractPagination } from "../../shared/pagination";

const [entity]Service = new [Entity]Service(
  repositoryFactory.get[Entity]Repository(),
);

export class [Entity]Controller {
  static getAll[Entities] = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const result = await [entity]Service.getAll[Entities](userId, extractPagination(req));
    res.status(200).json(result);
  };

  static get[Entity]ById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const entity = await [entity]Service.get[Entity]ById(req.params.id as string, userId);
    res.status(200).json(entity);
  };

  static create[Entity] = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const created = await [entity]Service.create[Entity]({ ...req.body, userId });
    res.status(201).json(created);
  };

  static update[Entity] = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const updated = await [entity]Service.update[Entity](req.params.id as string, req.body, userId);
    res.status(200).json(updated);
  };

  static delete[Entity] = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    await [entity]Service.delete[Entity](req.params.id as string, userId);
    res.status(204).send();
  };
}
```

**Checklist:**

- [ ] Service instantiated at module level with factory-provided repositories
- [ ] All methods are `static` arrow functions
- [ ] `userId` extracted from `req.user!.userId`
- [ ] No business logic in controller
- [ ] Correct HTTP status codes: 200 (get/update), 201 (create), 204 (delete)

---

## New Validation Schemas

**When:** Adding routes for a new entity.

**File to modify:** `src/app/validation/schemas.ts`

**Add:**

```typescript
export const create[Entity]Schema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required").max(255),
    // ... required fields
  }),
});

export const update[Entity]Schema = z.object({
  params: z.object({
    id: z.string().uuid("ID must be a valid UUID"),
  }),
  body: z.object({
    name: z.string().min(1).max(255).optional(),
    // ... optional updateable fields
  }).refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  }),
});
```

**Checklist:**

- [ ] Create schema validates all required fields
- [ ] Update schema validates `params.id` as UUID
- [ ] Update schema requires at least one field
- [ ] Reuse `idParamSchema` and `paginationQuerySchema` for get/delete

---

## New Route

**When:** Adding API endpoints for a new entity.

**File:** `src/app/routes/[entity]Routes.ts`

**Boilerplate:**

```typescript
import { Router } from "express";
import { [Entity]Controller } from "../controllers/[Entity]Controller";
import { validate } from "../validation/validate";
import {
  create[Entity]Schema,
  update[Entity]Schema,
  idParamSchema,
  paginationQuerySchema,
} from "../validation/schemas";

const router = Router();

// Add OpenAPI @openapi JSDoc blocks before each route

router.get("/", validate(paginationQuerySchema), [Entity]Controller.getAll[Entities]);
router.post("/", validate(create[Entity]Schema), [Entity]Controller.create[Entity]);
router.get("/:id", validate(idParamSchema), [Entity]Controller.get[Entity]ById);
router.put("/:id", validate(update[Entity]Schema), [Entity]Controller.update[Entity]);
router.delete("/:id", validate(idParamSchema), [Entity]Controller.delete[Entity]);

export default router;
```

**Other files to modify:**

- `src/app.ts` — import and register the route, with the shared rate limiter:
  ```typescript
  import [entity]Routes from "./app/routes/[entity]Routes";
  // After authMiddleware:
  app.use("/[entities]", apiLimiter, [entity]Routes);
  ```
- `src/config/swagger.ts` — add the request bodies to `requestBodies`, generated from the Zod schemas:
  ```typescript
  Create[Entity]Input: bodyOf(v.create[Entity]Schema),
  Update[Entity]Input: bodyOf(v.update[Entity]Schema),
  ```
  Response views (`[Entity]`, `[Entity]List: listOf("[Entity]")`) are hand-written there; request bodies never are.

**Checklist:**

- [ ] Every endpoint has validation middleware
- [ ] OpenAPI JSDoc annotations on every route, `$ref`-ing the generated request body
- [ ] Route registered in `src/app.ts` after `authMiddleware` (if protected) and behind `apiLimiter`
- [ ] Default export of router

---

## New Middleware

**When:** Adding cross-cutting logic that applies to multiple routes.

**File:** `src/app/middlewares/[name]Middleware.ts` (application-level) or `src/shared/[name].ts` (global)

**Checklist:**

- [ ] Follows Express middleware signature: `(req, res, next) => void`
- [ ] Calls `next()` on success or throws/responds on failure
- [ ] Registered in `src/app.ts` in the correct position in the middleware chain

---

## New Environment Variable

**When:** Adding a new configuration value.

**Files to modify:**

1. `src/shared/constants.ts` — add it to `baseEnvSchema` (or to `mongoEnvSchema` if it is Mongo-specific). `ENVIRONMENT` is parsed **eagerly at import time**, so a required variable without a default breaks every process, including tests
2. `.env.example` — add it with a safe placeholder and a comment
3. `.env` — your local value
4. `docs/guides/environment-vars.md` — document it
5. `docker-compose.yml` — only if it is a Docker-related variable

**Checklist:**

- [ ] Added to the Zod env schema with the right type and validation
- [ ] Has a `.default(...)` unless it must be set explicitly — otherwise every test that mocks `shared/constants` needs updating too
- [ ] Present in `.env.example`
- [ ] Documented in environment-vars.md
- [ ] If it must be set in production, add it to the checklist in `docs/guides/deployment.md`

---

## Changing Indexes

There is no migration system — the schema lives in the Mongoose models and indexes are the only thing that needs a deploy step.

- Declare the index on the schema in `src/infrastructure/models/[Entity]Model.ts`
- Make sure the model is listed in `scripts/sync-indexes.ts`
- `autoIndex` builds indexes automatically in development and test; in production it is off, so run `npm run db:sync-indexes` before the new code serves traffic (`scripts/deploy-lambda.sh` does it for you when `MONGO_URI` is set)

`syncIndexes()` **drops** indexes that are no longer declared in the schema, so removing a line from a model is a destructive production change — treat it as one.

---

## Tests for a New Module

**Files:** `src/__tests__/entities/[Entity].test.ts`, `src/__tests__/services/[Entity]Service.test.ts`, plus cases in `src/__tests__/validation/schemas.test.ts` and `src/__tests__/integration/api.test.ts`.

Full patterns are in `docs/guides/testing.md`. The three things that bite first:

- Mock `../../shared/constants` **before** any import of source code — it parses `process.env` eagerly at import time
- `jest.Mocked<I[Entity]Repository>` needs every method of the interface, so adding one to the interface means updating each mock
- The whole suite runs without MongoDB. Indexes, collation and real transaction atomicity are therefore **not** covered by any test you write here — verify those against a real replica set

Run `npm run ci` (typecheck + typecheck:tests + lint + test) before opening the PR.
