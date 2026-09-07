# lag-money-manager

REST API for personal money management — track accounts, categories and
transactions with automatic balance adjustments, budget per period, and see
where the money went.

## Quick Start

```bash
npm install
cp .env.example .env    # Configure environment variables (see docs/guides/environment-vars.md)
docker compose up -d    # Start MongoDB (single-node replica set) + Mongoku UI
npm run start:dev       # Start development server
```

> Collections are created on first write (no schema/migration step). Indexes are
> built automatically on connect in development (`autoIndex`), but in production
> they are created by `npm run db:sync-indexes`, run automatically as a deploy
> step (see `scripts/deploy-lambda.sh`) so index builds never run under live
> traffic.

> Money is stored as integer cents and balance adjustments run inside MongoDB
> transactions, so the database must be a **replica set** (the docker-compose
> service and MongoDB Atlas both are). A standalone `mongod` will reject writes.

## Lambda Deployment

```bash
export MONGO_URI="<production URI>"   # required: the deploy syncs indexes first
npm run deploy:lambda
```

Builds, syncs the indexes, assembles the package in `build/lambda-package/` and
uploads it. It installs the production dependencies **into that directory**, so
your working `node_modules` keeps its dev dependencies — pruning them in place
would leave you without `tsc` for the next build.

See [Deployment](docs/guides/deployment.md) for the one-time AWS setup and the
Lambda's own environment variables.

## Stack

| Technology      | Purpose                  |
| --------------- | ------------------------ |
| TypeScript 6    | Language                 |
| Express 5       | HTTP framework           |
| Zod 4           | Request validation       |
| Mongoose 9      | MongoDB ODM              |
| JWT + bcryptjs  | Authentication           |
| Pino            | Structured logging       |
| Jest 30         | Testing                  |
| Swagger/OpenAPI | API documentation        |
| Docker Compose  | Local dev infrastructure |

## Documentation

### For Developers & AI Agents

- [Agent Context & Working Instructions](docs/agent-context.md) — **Read this first**
- [Getting Started](docs/guides/getting-started.md) — Full setup guide

### Architecture

- [Architecture Overview](docs/architecture/overview.md)
- [Folder Structure](docs/architecture/folder-structure.md)
- [Design Patterns](docs/architecture/design-patterns.md)
- [Request Lifecycle](docs/architecture/request-lifecycle.md)
- [Dependency Rules](docs/architecture/dependency-rules.md)
- [ADR Template](docs/architecture/decisions/_template.md)

### Guides

- [Getting Started](docs/guides/getting-started.md)
- [Contributing](docs/guides/contributing.md)
- [Adding New Features](docs/guides/adding-new-features.md)
- [Environment Variables](docs/guides/environment-vars.md)
- [Testing](docs/guides/testing.md)
- [Deterministic Test Seed](docs/guides/testing-seed.md) — `npm run seed:test` for the frontend's E2E fixtures

### Modules

- [Auth](docs/modules/auth.md) — Registration, login, JWT
- [Users](docs/modules/users.md) — User profile management
- [Accounts](docs/modules/accounts.md) — Financial accounts and balances
- [Categories](docs/modules/categories.md) — Transaction categories
- [Transactions](docs/modules/transactions.md) — Income, expenses, transfers, adjustments
- [Budgets](docs/modules/budgets.md) — Per-period spending limits with live spend
- [Stats](docs/modules/stats.md) — Spending aggregated by category, day or tag

### Examples

- [Full Module Walkthrough (Transactions)](docs/examples/full-module-walkthrough.md)

### Reference

- [Error Handling](docs/reference/error-handling.md)
- [Anti-Patterns](docs/reference/anti-patterns.md)
- [Glossary](docs/reference/glossary.md)

### AI Agent Prompts

- [Prompts Index](docs/prompts/README.md)
- [Scan for Improvements](docs/prompts/scan-improvements.md)
- [Add a Feature](docs/prompts/add-feature.md)
- [Q&A and Docs Update](docs/prompts/qa-and-docs-update.md)
