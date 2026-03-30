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
