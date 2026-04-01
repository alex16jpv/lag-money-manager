# ADR-003: Express 5 as HTTP Framework

## Status

Accepted

## Context

The project needed an HTTP framework for building the REST API. Express is the most widely adopted Node.js web framework, and version 5 had recently reached stable release with meaningful improvements over version 4.

## Decision

Use **Express 5** as the HTTP framework.

Key capabilities leveraged:

- **Native async error handling:** Rejected promises in route handlers are automatically forwarded to the error middleware without explicit `try/catch` wrappers or `express-async-errors`
- **Improved routing:** Stricter path matching and better parameter handling
- **Active maintenance:** Long-term support from the Express team

## Consequences

**Easier:**

- Async route handlers and middleware work naturally — no wrapper utilities needed
- Controllers and services can `throw` or reject and the global error middleware catches everything
- Newer APIs and bug fixes from the latest major version

**Harder:**

- Some Express 4 middleware packages may not be fully compatible (though major packages like `cors`, `helmet`, `compression` work)
- Less community content and examples compared to Express 4 (as of adoption time)
- Breaking changes from Express 4 require attention during dependency upgrades

## Alternatives Considered

- **Express 4 + express-async-errors:** Mature ecosystem, but requires a wrapper package for async error handling and is no longer the latest version.
- **Fastify:** Higher performance benchmarks and built-in schema validation, but smaller ecosystem and different plugin architecture. Would add learning curve without proportional benefit for this project's scale.
- **Koa:** Lightweight and modern, but smaller ecosystem than Express and less middleware availability.
- **NestJS:** Full-featured framework with dependency injection, but significantly more complex and opinionated. Over-engineered for a personal finance API.
