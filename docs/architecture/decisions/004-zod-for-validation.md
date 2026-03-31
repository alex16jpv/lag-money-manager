# ADR-004: Zod for Request Validation

## Status

Accepted

## Context

The API needs to validate incoming request data (body, params, query) before it reaches the controller/service layers. The validation library must integrate well with TypeScript and support complex conditional validation rules (e.g., transaction type determines which account fields are required).

## Decision

Use **Zod 4** as the validation library.

- Validation schemas defined in `src/app/validation/schemas.ts`
- A reusable `validate()` middleware in `src/app/validation/validate.ts` applies schemas to requests
- Complex cross-field validation uses Zod's `superRefine()` (e.g., `createTransactionSchema` validates account requirements based on transaction type)
- Validation errors return structured 400 responses with field-level detail

## Consequences

**Easier:**

- TypeScript-first: schemas infer TypeScript types directly (`z.infer<typeof schema>`), eliminating type/validation drift
- Lightweight with zero dependencies
- `superRefine()` enables expressive conditional validation that would be verbose in other libraries
- Consistent validation error format across all endpoints

**Harder:**

- OpenAPI schema definitions in `swagger.ts` must be maintained separately — Zod schemas and OpenAPI component schemas are not automatically synchronized (see `docs/guides/contributing.md` for sync process)
- Less community momentum than Joi for traditional Node.js projects (though growing rapidly)
- Zod 4 is newer; some third-party integrations may lag behind

## Alternatives Considered

- **Joi:** Mature and widely used, but not TypeScript-first. Requires separate type definitions and validation schemas, leading to maintenance burden and potential drift.
- **class-validator + class-transformer:** Decorator-based approach common in NestJS. Requires class instances for validation, which conflicts with the project's preference for plain objects and functional-style validation.
- **AJV (JSON Schema):** Very fast, but JSON Schema syntax is verbose and harder to maintain than Zod's chainable API. Poor TypeScript integration.
