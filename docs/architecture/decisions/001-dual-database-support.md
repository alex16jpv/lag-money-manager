# ADR-001: Dual Database Support (MySQL + MongoDB)

## Status

**Superseded (2026-08-30) — reverted, not replaced by a later ADR.** The project
now targets **MongoDB only** (Mongoose).

## Reversal

The Sequelize/MySQL branch was deleted: its models, its migrations, the
`sequelizeProvider`, every `[Entity]SeqRepository`, and the `DB_TYPE=SEQ` code
path. `DB_TYPES` in `src/shared/constants.ts` now declares a single value,
`MONGO`, and the `SEQ_*` / `MYSQL_*` environment variables no longer exist.

Why the original decision did not hold:

- **The abstraction was pure maintenance cost.** Every entity needed two model
  definitions and two repository implementations that had to stay behaviourally
  identical. They drifted, and the drift produced real bugs.
- **It blocked the one feature the domain actually needs.** A transaction write
  must update the ledger document and `$inc` one or two account balances as a
  single atomic unit; the lowest common denominator of "works on both backends"
  ruled that out. The balance is now adjusted inside a MongoDB multi-document
  transaction (`withTransaction()` in `src/shared/unitOfWork.ts`) together with
  the transaction insert and the idempotency record, and money is stored as
  integer cents so `$inc` stays exact.
- **The flexibility was never exercised.** No deployment ever ran on MySQL.

**Cost of the reversal:** multi-document transactions require a **replica set** —
a standalone `mongod` rejects them outright. Production runs on MongoDB Atlas,
which is a replica set already; local development therefore runs the single-node
`rs0` defined in `docker-compose.yml`, and `MONGO_URI` must carry
`directConnection=true` to talk to a one-node set. That constraint is now a hard
requirement for running the API at all, not an optional optimisation.

`RepositoryFactory`, the provider registry and the repository interfaces in
`src/domain/repositories/` were kept. They no longer abstract over backends;
they survive as a seam for injecting fakes into service unit tests, and the
concrete implementations moved to `src/infrastructure/repositories/` (dropping
their `Mongo` suffix, since there is nothing left to distinguish them from).

The original decision is preserved below for historical context.

## Status (original)

Accepted

## Context

The project needed a data persistence layer for a personal finance REST API. Rather than committing to a single database technology, the team wanted deployment flexibility — allowing users and operators to choose between a relational database (MySQL) and a document database (MongoDB) without changing application code.

## Decision

Support both MySQL (via Sequelize ORM) and MongoDB (via Mongoose ODM) at runtime, selected by the `DB_TYPE` environment variable (`SEQ` or `MONGO`).

- Define **repository interfaces** in the domain layer (`IUserRepository`, `IAccountRepository`, etc.)
- Provide **two implementations** per repository: one using Sequelize, one using Mongoose
- Use a **RepositoryFactory** with a provider pattern to instantiate the correct implementation based on `DB_TYPE`
- Each provider lazily creates and caches repository instances

## Consequences

**Easier:**

- Deploying with either MySQL or MongoDB — no code changes required
- Testing with a different backend (e.g., develop on MongoDB, deploy on MySQL)
- Onboarding developers who are more familiar with one database over the other

**Harder:**

- Every new entity requires two repository implementations and two model definitions
- Database-specific features (transactions, aggregation pipelines) cannot be easily leveraged
- Schema migrations only apply to Sequelize; Mongoose relies on schema-on-write

## Alternatives Considered

- **Single database (MySQL only):** Simpler, but limits deployment options and eliminates the learning opportunity of supporting both paradigms.
- **Database abstraction library (e.g., TypeORM):** Could support multiple databases with a single implementation, but adds a heavy abstraction layer and limits fine-grained control.
- **Microservice per database:** Over-engineered for a personal finance app; unnecessary operational complexity.
