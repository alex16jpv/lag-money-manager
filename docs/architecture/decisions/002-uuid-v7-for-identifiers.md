# ADR-002: UUID v7 for All Entity Identifiers

## Status

Accepted

## Context

The application needs unique identifiers for all entities (users, accounts, categories, transactions). The identifiers must work across both MySQL and MongoDB backends without relying on database-generated auto-increment sequences, since the dual-database architecture (ADR-001) requires a database-agnostic ID strategy.

## Decision

Use **UUID v7** (RFC 9562) for all entity identifiers, generated in the application layer via the `uuid` package.

- IDs are generated in the domain entity constructors when not provided
- Format: `019576a0-d7b6-7d6d-af6a-2b7545f5ac70` (standard UUID string)
- Stored as `CHAR(36)` in MySQL and `String` in MongoDB

## Consequences

**Easier:**

- IDs are globally unique without coordination between application instances
- Time-ordered (embedded timestamp), so they sort chronologically and produce efficient B-tree indexes
- Database-agnostic — works identically in MySQL and MongoDB
- IDs can be generated before the database insert, enabling pre-association of related entities

**Harder:**

- Larger storage footprint than auto-increment integers (36 chars vs 4–8 bytes)
- Less human-readable than sequential integers for debugging
- Requires the `uuid` library as a runtime dependency

## Alternatives Considered

- **Auto-increment integers:** Database-specific; incompatible with the dual-database strategy. Would require different ID generation logic per backend.
- **UUID v4 (random):** Globally unique but not time-ordered, leading to poor index locality in B-tree indexes and slower insert performance at scale.
- **MongoDB ObjectId:** MongoDB-specific; not suitable for MySQL. Would require a translation layer.
- **ULID:** Similar properties to UUID v7 but less standard and less library support.
