# Contributing Guide

## Development Workflow

1. Create a branch from `main` for your feature or fix
2. Make changes following the conventions in `docs/agent-context.md`
3. Run lint and tests before committing
4. Submit a pull request with a clear description

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

## Commit Conventions

Use clear, descriptive commit messages. Prefer the format:

```
<type>: <short description>

<optional body with more detail>
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

## Keeping OpenAPI Specs in Sync with Zod Schemas

The OpenAPI specification is maintained **manually** via `swagger-jsdoc` annotations in route files and component schemas in `src/config/swagger.ts`. Zod validation schemas live separately in `src/app/validation/schemas.ts`. These two are **not automatically synchronized**.

### When to Update

Any change to request/response shapes requires updating **both** locations:

| Change                        | Update Zod schema (`schemas.ts`) | Update OpenAPI (`swagger.ts` + route JSDoc) |
| ----------------------------- | -------------------------------- | ------------------------------------------- |
| Add/remove a request field    | Yes                              | Yes                                         |
| Change field type/constraints | Yes                              | Yes                                         |
| Add a new endpoint            | Yes (if validated)               | Yes                                         |
| Change response shape         | No (DTOs handle this)            | Yes                                         |

### Sync Process

1. **Modify the Zod schema** in `src/app/validation/schemas.ts` (source of truth for validation)
2. **Update the OpenAPI component schema** in `src/config/swagger.ts` to match
3. **Update the route JSDoc annotations** in `src/app/routes/<module>Routes.ts` if request/response examples changed
4. **Verify** by starting the dev server and checking `/api-docs` in the browser

### Example

If adding a `tags` field to the create-account request:

```typescript
// 1. Zod schema (schemas.ts)
export const createAccountSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    type: z.enum([...]),
    tags: z.string().optional(),  // <-- add here
  }),
});

// 2. OpenAPI component (swagger.ts)
CreateAccount: {
  type: "object",
  properties: {
    name: { type: "string" },
    type: { type: "string", enum: [...] },
    tags: { type: "string" },  // <-- add here too
  },
}
```

> **Note:** There is no automated tool to generate OpenAPI from Zod or vice versa. Manual synchronization is required. Consider adding a PR checklist item: _"If request/response schemas changed, did you update both Zod and OpenAPI?"_
