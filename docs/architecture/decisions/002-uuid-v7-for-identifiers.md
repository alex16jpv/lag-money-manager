# ADR-002: UUID v7 for All Entity Identifiers

## Status

Accepted. The original motivation (database portability, ADR-001) is gone — ADR-001 was superseded and the project is MongoDB-only — but the decision stands on the reasons below that survived it.

## Context

The application needs unique identifiers for all entities (users, accounts, categories, transactions, budgets). At the time this was decided, the identifiers also had to work across both MySQL and MongoDB backends without relying on database-generated auto-increment sequences, since the dual-database architecture (ADR-001) required a database-agnostic ID strategy.

## Decision

Use **UUID v7** (RFC 9562) for all entity identifiers, generated in the application layer via the `uuid` package.

- IDs are generated in the domain entity constructors when not provided (`this.id = id ?? uuidv7()`)
- Format: `019576a0-d7b6-7d6d-af6a-2b7545f5ac70` (standard UUID string)
- Stored as the document `_id`, typed `String` — the Mongoose schemas declare `_id: { type: String, required: true }`, so MongoDB never generates an `ObjectId` of its own

## Consequences

**Easier:**

- IDs are globally unique without coordination between application instances
- Time-ordered (embedded timestamp), so they sort chronologically and produce efficient B-tree indexes — this is what makes `_id`-based cursor pagination correct
- IDs can be generated before the database insert, enabling pre-association of related entities and letting a whole unit of work be assembled in memory first

**Harder:**

- Larger storage footprint than an `ObjectId` (36 chars vs 12 bytes)
- Less human-readable than sequential integers for debugging
- Requires the `uuid` library as a runtime dependency

## Alternatives Considered

- **Auto-increment integers:** Database-specific; incompatible with the (then current) dual-database strategy. Would require different ID generation logic per backend.
- **UUID v4 (random):** Globally unique but not time-ordered, leading to poor index locality in B-tree indexes and slower insert performance at scale.
- **MongoDB ObjectId:** Rejected at the time as MongoDB-specific. It has since become viable — it is also time-ordered and more compact — but switching now would mean migrating every stored `_id` and every cross-document reference for no functional gain.
- **ULID:** Similar properties to UUID v7 but less standard and less library support.
