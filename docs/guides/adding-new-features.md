# Adding New Features

This guide covers how to add each type of component in the project. Follow the exact patterns described here to maintain consistency.

---

## New Module (Full Vertical Slice)

A full module consists of all layers from route to database. Create these files in order:

1. Domain entity
2. DTOs
3. Sequelize model
4. Mongoose model
5. Repository interface
6. Sequelize repository
7. Mongoose repository
8. Register in both providers and factory
9. Service
10. Controller
11. Validation schemas
12. Routes
13. Register routes in `src/app.ts`
14. Migration file (for Sequelize)
15. Tests

Refer to the sections below for each file.

---

## New Domain Entity

**When:** You need to represent a new business object.

**File:** `src/domain/entities/[Entity].ts`

**Naming:** `PascalCase.ts` (e.g., `Budget.ts`)

**Boilerplate:**

```typescript
export interface [Entity]Props {
  id?: string;
  name: string;
  // ... entity-specific required fields
  userId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class [Entity] {
  id: string;
  name: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;

  constructor({ id, name, userId, createdAt, updatedAt }: [Entity]Props) {
    this.id = id!;
    this.name = name;
    this.userId = userId;
    this.createdAt = createdAt!;
    this.updatedAt = updatedAt!;
  }
}
```

**Other files to modify:** None (entities are standalone).

**Checklist:**

- [ ] Props interface defined with optional `id`, `createdAt`, `updatedAt`
- [ ] Class properties match props
- [ ] Constructor uses null coalescing (`??`) for optional fields

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

## New Sequelize Model

**When:** Adding a new entity that must be persisted in MySQL.

**File:** `src/domain/models/sequelize/[Entity]Model.ts`

**Naming:** `PascalCase` with `Model` suffix

**Boilerplate:**

```typescript
import { DataTypes, Model, Sequelize } from "sequelize";
import { MODEL_NAMES } from "../../../shared/constants";
import { v7 as uuidv7 } from "uuid";

export class [Entity]Model extends Model {
  id!: string;
  name!: string;
  userId!: string;

  static associate() {
    [Entity]Model.belongsTo(UserModel, { foreignKey: "userId", as: "user" });
  }
}

export default (sequelize: Sequelize) => {
  [Entity]Model.init(
    {
      id: {
        type: DataTypes.CHAR(36),
        defaultValue: () => uuidv7(),
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      userId: {
        type: DataTypes.CHAR(36),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: MODEL_NAMES.[ENTITY],
    },
  );
  return [Entity]Model;
};
```

**Other files to modify:**

- `src/shared/constants.ts` — Add entity name to `MODEL_NAMES`
- `src/domain/models/sequelize/models.ts` — Add re-export
- Create a migration file in `src/database/migrations/`

**Checklist:**

- [ ] Model class extends `Model`
- [ ] UUID v7 as default primary key
- [ ] `associate()` static method defined
- [ ] Registered in `MODEL_NAMES` constant
- [ ] Re-exported from `models.ts`
- [ ] Migration file created

---

## New Mongoose Model

**When:** Adding a new entity that must be persisted in MongoDB.

**File:** `src/domain/models/mongoose/[Entity]MongoModel.ts`

**Naming:** `PascalCase` with `MongoModel` suffix

**Boilerplate:**

```typescript
import mongoose, { Schema } from "mongoose";
import { MODEL_NAMES } from "../../../shared/constants";

export interface I[Entity]Document {
  _id: string;
  name: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

const [Entity]Schema = new Schema<I[Entity]Document>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    userId: { type: String, required: true },
  },
  { timestamps: true },
);

export const [Entity]MongoModel = mongoose.model<I[Entity]Document>(
  MODEL_NAMES.[ENTITY],
  [Entity]Schema,
);
```

**Checklist:**

- [ ] Document interface with `_id` as string
- [ ] Schema uses `{ timestamps: true }`
- [ ] Model name matches `MODEL_NAMES` constant

---

## New Repository Interface

**When:** Adding data access for a new entity.

**File:** `src/domain/repositories/[entity]/I[Entity]Repository.ts`

**Create directory:** `src/domain/repositories/[entity]/`

**Boilerplate:**

```typescript
import { PaginatedResult, PaginationParams } from "../../../shared/pagination";
import { [Entity] } from "../../entities/[Entity]";
import { IRepository } from "../IRepository";

export interface I[Entity]Repository extends IRepository<[Entity]> {
  getAllByUserId(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<[Entity]>>;
}
```

**Checklist:**

- [ ] Extends `IRepository<T>`
- [ ] Adds `getAllByUserId()` if entity is user-scoped

---

## New Sequelize Repository

**When:** Implementing data access for MySQL.

**File:** `src/domain/repositories/[entity]/[Entity]SeqRepository.ts`

**Boilerplate:** Follow the pattern in `src/domain/repositories/account/AccountSeqRepository.ts`:

- Implement the entity-specific interface
- Use `this.model.findByPk()`, `findAndCountAll()`, `create()`, `update()`, `destroy()`
- Map results to domain entities via `new [Entity](result.toJSON())`
- Include `paginatedFindAll()` private method for cursor/offset pagination
- Throw `ApiError("NotFound", ...)` in update/delete when entity not found

**Other files to modify:**

- `src/app/factories/providers/sequelizeProvider.ts` — Register the new repository

**Checklist:**

- [ ] Implements `I[Entity]Repository`
- [ ] All methods return domain entities, not raw models
- [ ] Pagination support (offset + cursor)
- [ ] Registered in Sequelize provider

---

## New Mongoose Repository

**When:** Implementing data access for MongoDB.

**File:** `src/domain/repositories/[entity]/[Entity]MongoRepository.ts`

**Boilerplate:** Follow the pattern in `src/domain/repositories/account/AccountMongoRepository.ts`:

- Implement the entity-specific interface
- Use `toEntity()` private method to map Mongoose documents to domain entities
- Use UUID v7 for `_id` on `create()`
- Use `.lean()` for read queries
- Include `paginatedFind()` private method

**Other files to modify:**

- `src/app/factories/providers/mongoProvider.ts` — Register the new repository

**Checklist:**

- [ ] Implements `I[Entity]Repository`
- [ ] `toEntity()` mapper from document to domain entity
- [ ] UUID v7 generated for new documents
- [ ] `.lean()` used on queries
- [ ] Registered in Mongo provider

---

## Register in Repository Factory

**When:** After creating both repository implementations.

**Files to modify:**

1. `src/app/factories/RepositoryFactory.ts`:
   - Add key to `REPO_KEYS`: `[ENTITY]: "[entity]"`
   - Add typed getter: `get[Entity]Repository(): I[Entity]Repository`

2. `src/app/factories/providers/sequelizeProvider.ts`:
   - Add: `factory.register("[entity]", () => new [Entity]SeqRepository());`

3. `src/app/factories/providers/mongoProvider.ts`:
   - Add: `factory.register("[entity]", () => new [Entity]MongoRepository());`

---

## New Service

**When:** Adding business logic for a new entity.

**File:** `src/app/services/[Entity]Service.ts`

**Boilerplate:**

```typescript
import { [Entity] } from "../../domain/entities/[Entity]";
import { I[Entity]Repository } from "../../domain/repositories/[entity]/I[Entity]Repository";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { ApiError } from "../../shared/errors";
import { Create[Entity]DTO, Update[Entity]DTO } from "../dtos/[Entity]DTO";

export class [Entity]Service {
  constructor(private repo: I[Entity]Repository) {}

  async getAll[Entities](
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<[Entity]>> {
    return await this.repo.getAllByUserId(userId, pagination);
  }

  async get[Entity]ById(id: string, userId: string): Promise<[Entity]> {
    const entity = await this.repo.getById(id);
    if (!entity) throw new ApiError("NotFound", "[Entity] not found");
    if (entity.userId !== userId) throw new ApiError("Forbidden", "Access denied");
    return entity;
  }

  async create[Entity](dto: Create[Entity]DTO): Promise<[Entity]> {
    const entity = new [Entity](dto);
    return await this.repo.create(entity);
  }

  async update[Entity](id: string, dto: Update[Entity]DTO, userId: string): Promise<[Entity]> {
    if (dto.id && dto.id !== id) throw new ApiError("BadRequest", "[Entity] id does not match");
    const existing = await this.repo.getById(id);
    if (!existing) throw new ApiError("NotFound", "[Entity] not found");
    if (existing.userId !== userId) throw new ApiError("Forbidden", "Access denied");
    return await this.repo.update(id, dto);
  }

  async delete[Entity](id: string, userId: string): Promise<void> {
    const existing = await this.repo.getById(id);
    if (!existing) throw new ApiError("NotFound", "[Entity] not found");
    if (existing.userId !== userId) throw new ApiError("Forbidden", "Access denied");
    return await this.repo.delete(id);
  }
}
```

**Checklist:**

- [ ] Constructor receives repository interface (dependency injection)
- [ ] All methods that access user-scoped data verify ownership
- [ ] Uses `ApiError` for NotFound, Forbidden, BadRequest
- [ ] Returns domain entities
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

- `src/app.ts` — Import and register the route:
  ```typescript
  import [entity]Routes from "./app/routes/[entity]Routes";
  // After authMiddleware:
  app.use("/[entities]", [entity]Routes);
  ```

**Checklist:**

- [ ] Every endpoint has validation middleware
- [ ] OpenAPI JSDoc annotations on every route
- [ ] Route registered in `src/app.ts` after `authMiddleware` (if protected)
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

1. `src/shared/constants.ts` — Add to the appropriate Zod env schema (`baseEnvSchema`, `seqEnvSchema`, or `mongoEnvSchema`)
2. `.env` — Add the variable with a value
3. `docs/guides/environment-vars.md` — Document the new variable
4. `docker-compose.yml` — If it's a Docker-related variable

**Checklist:**

- [ ] Added to Zod env schema with proper type and validation
- [ ] Default value provided if applicable
- [ ] Documented in environment-vars.md

---

## New Migration (Sequelize)

**When:** Changing the MySQL database schema.

**Command:**

```bash
npm run db:migration:generate -- --name [description]
```

**File:** `src/database/migrations/YYYYMMDDHHMMSS-[description].js`

**Naming:** Timestamp prefix is auto-generated. Use descriptive kebab-case for the name (e.g., `create-budgets`, `add-column-to-transactions`).

**Checklist:**

- [ ] `up` function creates/alters tables
- [ ] `down` function reverses the change
- [ ] UUID primary keys use `CHAR(36)`
- [ ] Foreign keys reference correct tables
- [ ] Run `npm run db:migrate` to test
