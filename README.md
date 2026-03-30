# lag-money-manager

REST API for personal money management — track accounts, categories, and transactions with automatic balance adjustments.

## Quick Start

```bash
npm install
cp .env.example .env    # Configure environment variables (see docs/guides/environment-vars.md)
docker compose up -d    # Start MySQL + MongoDB containers
npm run db:migrate      # Run database migrations (MySQL)
npm run start:dev       # Start development server
```

## Stack

| Technology      | Purpose                  |
| --------------- | ------------------------ |
| TypeScript 6    | Language                 |
| Express 5       | HTTP framework           |
| Zod 4           | Request validation       |
| Sequelize 6     | MySQL ORM                |
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
