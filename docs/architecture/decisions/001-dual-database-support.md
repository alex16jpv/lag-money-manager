# ADR-001: Dual Database Support (MySQL + MongoDB)

## Status

**Superseded (2026-08-30).** The dual-database design was removed. The project
now targets **MongoDB only** (Mongoose). The Sequelize/MySQL implementation, its
models, migrations, and the `DB_TYPE=SEQ` code path were deleted, because the
abstraction was pure maintenance cost (duplicated ~14% of the code, caused real
divergence bugs, and blocked native transactions). Balance adjustments now rely
on MongoDB transactions + atomic `$inc`, and money is stored as integer cents.
The `RepositoryFactory` and repository interfaces are kept only as a light seam
for testing. See the Fase 1 audit deliverables for the full rationale.

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
