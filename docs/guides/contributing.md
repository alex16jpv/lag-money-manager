# Contributing Guide

## Development Workflow

1. Create a branch from `main` for your feature or fix
2. Make changes following the conventions in `docs/agent-context.md`
3. Run `npm run ci` before committing — it is the same gate CI enforces
4. Commit **one item per commit** (one fix, one feature, one audit finding), with the scope in the subject
5. Submit a pull request with a clear description

## Code Quality Checks

### Linting

```bash
npm run lint          # Check for lint errors
npm run lint:fix      # Auto-fix lint errors
```

ESLint is configured with:

- TypeScript-ESLint recommended rules
- Prettier integration (formatting conflicts resolved)
- `simple-import-sort` for consistent import ordering
- Explicit return types required (warnings)
- No explicit `any` (warnings)
- Unused variables with `_` prefix are allowed

### Formatting

```bash
npm run format        # Format all TypeScript files
npm run format:check  # Check formatting without modifying
```

Prettier handles all code formatting. Do not manually format code.

### Testing

```bash
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

All tests must pass before merging.

### The full gate

```bash
npm run ci    # typecheck + typecheck:tests + lint + test
```

`.github/workflows/ci.yml` runs exactly these four steps on every push and pull request. Note that `typecheck:tests` is separate: Jest runs with `diagnostics: false`, so a type error inside a test file passes `npm test` and only fails that step.

## Commit Conventions

One commit per item. A commit that fixes two unrelated things is two commits.

```
<type>(<scope>): <short description>

<optional body explaining WHY, not what>
```

The scope is the module or area touched (`accounts`, `budgets`, `auth`, `transactions`, `api`, `logs`, ...). Real examples from the history:

```
fix(accounts): setDefault unsets the old default BEFORE setting the new one
feat(logs): one completion log line per request, with the rejection reason
docs(api): generate OpenAPI request bodies from the Zod schemas
```

Common types:

- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or updating tests
- `docs`: Documentation changes
- `chore`: Build, tooling, dependency updates

## Pull Request Guidelines

1. **Title:** Brief description of the change
2. **Description:** What changed and why
3. **Testing:** How the change was tested
4. **Docs:** List any documentation files updated

## File Conventions

- Follow the naming conventions in `docs/agent-context.md` Section 3
- Place files in the correct directory per `docs/architecture/folder-structure.md`
- Follow the dependency rules in `docs/architecture/dependency-rules.md`

## Adding Dependencies

1. Only add dependencies that are truly needed
2. Prefer well-maintained packages with minimal sub-dependencies
3. Update `docs/guides/getting-started.md` with the new dependency
4. Update `docs/architecture/overview.md` if it's a significant addition

## Keeping the OpenAPI Spec in Sync

`src/config/swagger.ts` builds the spec from three sources, and only one of them is hand-written:

| Part                          | Source                                                                          | Hand-written?                                   |
| ----------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Request bodies**            | Generated from the Zod schemas with `z.toJSONSchema(..., { target: "openapi-3.0", io: "input" })` | **No** — never hand-write one                   |
| **Response views**            | Mirrors of the entities/DTOs the API serializes, in `swagger.ts`                 | Yes                                             |
| **Paths, params, responses**  | `@openapi` JSDoc blocks above each route in `src/app/routes/*.ts`                | Yes                                             |

Enum values in the response views come from `src/shared/constants.ts` (`enumOf(...)`), so they cannot drift from the code either.

### What that means when you change a shape

| Change                             | Zod schema (`schemas.ts`) | `swagger.ts`                        | Route JSDoc                       |
| ---------------------------------- | ------------------------- | ------------------------------------ | --------------------------------- |
| Add/remove a **request** field     | Yes — the only edit       | No (regenerated)                     | Only if the description changes    |
| Change a request field's rules     | Yes — the only edit       | No (regenerated)                     | No                                 |
| Add a **new endpoint**             | Yes, if validated         | Add the request body to `requestBodies` if it takes one | Yes — a new `@openapi` block       |
| Change a **response** shape        | No (DTOs/entities)        | Yes — update the response view       | Only if the `$ref` changes         |
| Add an enum value                  | No (derived from constants) | No (derived from constants)        | No                                 |

**Verify** with `npm run start:dev` and `/api-docs`. Note that Swagger UI is only mounted when `NODE_ENV !== "production"`, so `/api-docs` does not exist on the deployed API.

## Conventions a Review Will Check

These are the recurring ones; `docs/agent-context.md` has the full set.

- **Layers.** Domain (`src/domain/`) holds entities and repository *interfaces* and imports nothing from `app/` or `infrastructure/`. Mongoose models and the concrete repositories live in `src/infrastructure/`. Services depend on the interface, never on a model.
- **Validation.** Every endpoint gets a Zod schema in `src/app/validation/schemas.ts` and `validate(schema)` in the route. `validate` replaces `req.body`/`req.params` with the parsed values, so anything not declared in the schema never reaches a service — do not read undeclared fields off the request.
- **Repository access.** Controllers get repositories from `repositoryFactory.get<Entity>Repository()` and pass them into the service constructor. No `new SomeRepository()` outside the provider.
- **Pagination.** List endpoints return `buildPaginatedResult(...)` from `src/shared/pagination.ts` — `{ data, pagination: { limit, offset, total, hasMore, nextCursor } }`. Do not hand-roll that envelope.
- **Money.** The API speaks decimals with at most 2 places; storage is **integer cents**. Convert with `toCents`/`fromCents` from `src/shared/money.ts` at the repository boundary only, and never let a float amount reach a Mongo document.
- **Soft delete.** `delete` sets `archivedAt` (transactions use `deletedAt`); it does not remove documents. Listings filter `archivedAt: null` by default and reads resolve archived rows so the client can tell "archived" from "gone".
- **Errors.** Throw `ApiError(name, message, code)` with a **stable `code`** (`ACCOUNT_LIMIT_REACHED`, `RESOURCE_ARCHIVED`, `RATE_LIMITED`, ...). Clients branch on `code`, never on `message`, so renaming one is a breaking change. A resource owned by someone else is a `404`, not a `403`.
