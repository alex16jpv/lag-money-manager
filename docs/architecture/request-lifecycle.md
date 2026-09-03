# Request Lifecycle

## Overview

Every HTTP request follows the same pipeline, assembled in `src/app.ts`. The probe routes (`/` and `/health/db`) and `/auth/*` skip the JWT auth middleware; every other route requires a valid access token. Everything past the gateway-secret middleware — probes included — must carry the `x-api-secret` header when `API_SECRET` is set.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant RID as RequestId MW
    participant RLOG as RequestLog MW
    participant SEC as Security MW<br/>(Helmet, Compression, CORS)
    participant BP as Body Parser
    participant GATE as GatewaySecret MW<br/>+ Rate Limiter
    participant DBR as DbReadiness MW
    participant AUTH as Auth MW
    participant VAL as Validation MW<br/>(Zod)
    participant CTRL as Controller
    participant SVC as Service
    participant REPO as Repository
    participant DB as Database
    participant ERR as Error MW

    C->>RID: HTTP Request
    RID->>RID: Generate/forward X-Request-Id
    RID->>RLOG: next()
    RLOG->>RLOG: Start timer, hook res "finish"
    RLOG->>SEC: next()
    SEC->>SEC: Set security headers, compress, check CORS
    SEC->>BP: next()
    BP->>BP: Parse JSON body (limit 10kb)
    BP->>GATE: next()
    GATE->>GATE: Compare x-api-secret (timing-safe), check rate limit
    alt Missing/wrong secret
        GATE->>ERR: throw ApiError("Forbidden")
        ERR->>C: 403 JSON response
    end
    GATE->>DBR: next()
    DBR->>DBR: await connectMongo() (503 on failure)

    alt Public route (/auth/*)
        DBR->>VAL: Route matched
    else Protected route
        DBR->>AUTH: Route matched
        AUTH->>AUTH: Extract Bearer token
        AUTH->>AUTH: Verify JWT signature
        alt Invalid/missing token
            AUTH->>ERR: throw ApiError("Unauthorized")
            ERR->>C: 401 JSON response
        else Valid token
            AUTH->>AUTH: Set req.user = { userId, email, timezone }
            AUTH->>VAL: next()
        end
    end

    VAL->>VAL: Parse { body, query, params } against Zod schema
    alt Validation fails
        VAL->>C: 400 { error: "ValidationError", code: "VALIDATION", details: [...] }
    else Validation passes
        VAL->>VAL: Replace req.body/req.params with the parsed values
        VAL->>CTRL: next()
    end

    CTRL->>CTRL: Extract userId from req.user<br/>Extract pagination from req.query
    CTRL->>SVC: Call service method with DTO/params

    SVC->>SVC: Business logic (ownership check → 404, not 403)
    alt Business rule violation
        SVC->>ERR: throw ApiError(NotFound/BadRequest/Conflict)
    else Success path
        SVC->>REPO: Call repository method
        REPO->>DB: Database query
        DB->>REPO: Raw result
        REPO->>REPO: Map to domain entity
        REPO->>SVC: Domain entity / paginated result
        SVC->>CTRL: Return result
        CTRL->>C: HTTP response (200/201/204)
    end

    ERR->>ERR: Catch error by type, stash code+message on res.locals
    alt ApiError
        ERR->>C: error.statusCode + JSON (code when set)
    else DomainValidationError
        ERR->>C: 400 + code VALIDATION
    else MongoServerError (code 11000)
        ERR->>C: 409 + code DUPLICATE
    else CastError
        ERR->>C: 400 + code INVALID_ID
    else Mongo connection unavailable
        ERR->>ERR: Log error with requestId
        ERR->>C: 503 + code DB_UNAVAILABLE
    else Unknown error
        ERR->>ERR: Log error with requestId
        ERR->>C: 500 + code INTERNAL
    end

    ERR-->>RLOG: response finishes
    RLOG->>RLOG: Emit one log line<br/>method, path, status, durationMs, requestId, code
```

## Middleware Execution Order

Registered in this order in `src/app.ts`:

1. **HTTPS redirect** — production only; also sets `trust proxy` so the client IP survives the proxy
2. **Request ID** (`src/shared/requestId.ts`) — Accepts a client-supplied `X-Request-Id` when it matches `^[a-zA-Z0-9\-_]{1,64}$`, otherwise generates one; echoes it back on the response
3. **Request Log** (`src/app/middlewares/requestLogMiddleware.ts`) — Registered early so it observes every request, even one rejected further down; emits its line on `res.finish`
4. **Helmet** — Sets security HTTP headers
5. **Compression** — Gzip response compression
6. **CORS** — Origins from `CORS_ORIGIN` (comma-separated)
7. **Body Parser** — JSON parsing with 10kb limit
8. **Swagger UI** (`/api-docs`) — Mounted only when `NODE_ENV !== "production"`
9. **Gateway Secret** (`src/app/middlewares/gatewaySecretMiddleware.ts`) — Timing-safe comparison of the `x-api-secret` header against `API_SECRET`; skipped when the variable is unset outside production, and a hard 500 when it is unset _in_ production
10. **Rate Limiter** — `express-rate-limit`, `RATE_LIMIT_MAX` (default 200) per 15-minute window, applied per route group
11. **Public routes** — `GET /` and `GET /health/db`, both before the DB-readiness and auth walls
12. **DB Readiness** (`src/app/middlewares/dbReadinessMiddleware.ts`) — `await connectMongo()`; command buffering is off, so a request must not reach a repository while disconnected
13. **`/auth` routes** — Public; each one also passes through the MongoDB-backed `authRateLimit()` limiter, which survives Lambda instance churn
14. **Auth Middleware** (`src/app/middlewares/authMiddleware.ts`) — HS256 JWT verification, sets `req.user`
15. **Protected routes** — `/users`, `/accounts`, `/categories`, `/transactions`, `/budgets`, `/stats`
16. **Validation** (`src/app/validation/validate.ts`) — Zod schema validation (per-route, inside each router)
17. **Controller** — Request handling and service delegation
18. **Error Middleware** (`src/shared/middlewares.ts`) — Catches all thrown/rejected errors

## Request Logging

`requestLogMiddleware` writes exactly one structured line per request when the response finishes:

```json
{
  "method": "POST",
  "path": "/transactions",
  "status": 400,
  "durationMs": 12.4,
  "requestId": "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
  "code": "CURRENCY_MISMATCH",
  "errorMessage": "...",
  "userId": "019576a0-..."
}
```

- `code` and `errorMessage` appear only when the error middleware stashed them on `res.locals`, so a rejected request says _why_ — including a 403 from the gateway secret, which otherwise leaves no trace.
- `userId` appears only once `authMiddleware` has populated `req.user`.
- Level follows the status: `error` for 5xx, `warn` for 4xx, `info` otherwise — except the probe paths `/` and `/health/db`, which log at `debug` while healthy so keepalive traffic doesn't drown real requests.

## Error Handling Path

All errors, whether thrown synchronously or rejected from async operations, are caught by the global error middleware at the end of the chain. The middleware identifies the error type, records the machine-readable code on `res.locals` for the request log, and returns the appropriate HTTP status code and JSON response. See `docs/reference/error-handling.md` for full details.

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

**Error with a machine-readable code:**

```json
{
  "error": "BadRequestError",
  "message": "Category is archived",
  "code": "CATEGORY_ARCHIVED"
}
```

`code` is the field clients branch on; `message` is human-facing prose and may be reworded at any time.

**Validation error:**

```json
{
  "error": "ValidationError",
  "message": "Invalid request data",
  "code": "VALIDATION",
  "details": [
    { "field": "body.amount", "message": "Amount must be greater than 0" }
  ]
}
```
