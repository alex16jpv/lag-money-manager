# lag-money-manager

REST API for personal money management — track accounts, categories, and transactions with automatic balance adjustments.

## Quick Start

```bash
npm install
cp .env.example .env    # Configure environment variables (see docs/guides/environment-vars.md)
docker compose up -d    # Start MongoDB (single-node replica set) + Mongoku UI
npm run start:dev       # Start development server
```

> Indexes are created automatically on connect (Mongoose `autoIndex`), and
> collections are created on first write, so there is no schema/migration step.
> `npm run db:sync-indexes` exists only as an optional maintenance tool (it also
> drops indexes removed from the schemas).

> Money is stored as integer cents and balance adjustments run inside MongoDB
> transactions, so the database must be a **replica set** (the docker-compose
> service and MongoDB Atlas both are). A standalone `mongod` will reject writes.

## Lambda Deployment

```bash
npm run build           # Build TypeScript code
npm ci --omit=dev
zip -r function.zip dist/ node_modules package.json
# Upload function.zip to AWS Lambda and set handler to dist/lambda.handler
# Configure environment variables in Lambda console (see docs/guides/environment-vars.md)
```

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

### Modules

- [Auth](docs/modules/auth.md) — Registration, login, JWT
- [Users](docs/modules/users.md) — User profile management
- [Accounts](docs/modules/accounts.md) — Financial accounts and balances
- [Categories](docs/modules/categories.md) — Transaction categories
- [Transactions](docs/modules/transactions.md) — Income, expenses, transfers

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
