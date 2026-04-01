# Request Lifecycle

## Overview

Every HTTP request follows the same pipeline. Public routes (`/auth/*`) skip the auth middleware; all other routes require a valid JWT token.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant RID as RequestId MW
    participant SEC as Security MW<br/>(Helmet, CORS, Rate Limit)
    participant BP as Body Parser
    participant AUTH as Auth MW
    participant VAL as Validation MW<br/>(Zod)
    participant CTRL as Controller
    participant SVC as Service
    participant REPO as Repository
    participant DB as Database
    participant ERR as Error MW

    C->>RID: HTTP Request
    RID->>RID: Generate/forward X-Request-Id
    RID->>SEC: next()
    SEC->>SEC: Set security headers, check CORS, check rate limit
    SEC->>BP: next()
    BP->>BP: Parse JSON body (limit 10kb)

    alt Public route (/auth/*)
        BP->>VAL: Route matched
    else Protected route
        BP->>AUTH: Route matched
        AUTH->>AUTH: Extract Bearer token
        AUTH->>AUTH: Verify JWT signature
        alt Invalid/missing token
            AUTH->>ERR: throw ApiError("Unauthorized")
            ERR->>C: 401 JSON response
        else Valid token
            AUTH->>AUTH: Set req.user = { userId, email }
            AUTH->>VAL: next()
        end
    end

    VAL->>VAL: Parse { body, query, params } against Zod schema
    alt Validation fails
        VAL->>C: 400 { error: "ValidationError", details: [...] }
    else Validation passes
        VAL->>CTRL: next()
    end

    CTRL->>CTRL: Extract userId from req.user<br/>Extract pagination from req.query
    CTRL->>SVC: Call service method with DTO/params

    SVC->>SVC: Business logic (ownership check, etc.)
    alt Business rule violation
        SVC->>ERR: throw ApiError(NotFound/Forbidden/BadRequest)
    else Success path
        SVC->>REPO: Call repository method
        REPO->>DB: Database query
        DB->>REPO: Raw result
        REPO->>REPO: Map to domain entity
        REPO->>SVC: Domain entity / paginated result
        SVC->>CTRL: Return result
        CTRL->>C: HTTP response (200/201/204)
    end

    ERR->>ERR: Catch error by type
    alt ApiError
        ERR->>C: error.statusCode + JSON
    else DomainValidationError
        ERR->>C: 400 + JSON
    else SequelizeUniqueConstraintError
        ERR->>C: 409 + JSON
    else MongoServerError (code 11000)
        ERR->>C: 409 + JSON
    else Unknown error
        ERR->>ERR: Log error with requestId
        ERR->>C: 500 + generic JSON
    end
```

## Middleware Execution Order

1. **Request ID** (`src/shared/requestId.ts`) — Assigns `X-Request-Id` header
2. **Helmet** — Sets security HTTP headers
3. **Compression** — Gzip response compression
4. **CORS** — Cross-origin resource sharing policy
5. **Rate Limiter** — 100 requests per 15-minute window
6. **Body Parser** — JSON parsing with 10kb limit
7. **Route Matching** — Express router selects the matching route
8. **Auth Middleware** (`src/app/middlewares/authMiddleware.ts`) — JWT verification (protected routes only)
9. **Validation** (`src/app/validation/validate.ts`) — Zod schema validation (per-route)
10. **Controller** — Request handling and service delegation
11. **Error Middleware** (`src/shared/middlewares.ts`) — Catches all thrown/rejected errors

## Error Handling Path

All errors, whether thrown synchronously or rejected from async operations, are caught by the global error middleware at the end of the chain. The middleware identifies the error type and returns the appropriate HTTP status code and JSON response format. See `docs/reference/error-handling.md` for full details.

## Response Format

**Success (single entity):**

```json
{
  "id": "019576a0-d7b6-...",
  "name": "...",
  "...": "..."
}
```

**Success (paginated list):**

```json
{
  "data": [...],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 42,
    "hasMore": true,
    "nextCursor": "019576a0-..."
  }
}
```

**Error:**

```json
{
  "error": "NotFoundError",
  "message": "Transaction not found"
}
```

**Validation error:**

```json
{
  "error": "ValidationError",
  "message": "Invalid request data",
  "details": [
    { "field": "body.amount", "message": "Amount must be greater than 0" }
  ]
}
```
