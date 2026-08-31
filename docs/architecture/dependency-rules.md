# Dependency Rules

## Layer Dependency Diagram

```mermaid
graph TD
    ROUTES["Routes<br/>(src/app/routes/)"]
    CTRL["Controllers<br/>(src/app/controllers/)"]
    SVC["Services<br/>(src/app/services/)"]
    REPO_I["Repository Interfaces<br/>(src/domain/repositories/)"]
    REPO_IMPL["Repository Implementations<br/>(src/infrastructure/repositories/)"]
    ENT["Domain Entities<br/>(src/domain/entities/)"]
    DTO["DTOs<br/>(src/app/dtos/)"]
    VAL["Validation Schemas<br/>(src/app/validation/)"]
    FACTORY["Repository Factory<br/>(src/app/factories/)"]
    MODELS["Mongoose Models<br/>(src/infrastructure/models/)"]
    SHARED["Shared Utilities<br/>(src/shared/)"]
    CONFIG["Config<br/>(src/config/)"]
    MW["Middlewares<br/>(src/app/middlewares/)"]

    ROUTES -->|imports| CTRL
    ROUTES -->|imports| VAL
    CTRL -->|imports| SVC
    CTRL -->|imports| FACTORY
    CTRL -->|imports| SHARED
    SVC -->|imports| REPO_I
    SVC -->|imports| ENT
    SVC -->|imports| DTO
    SVC -->|imports| SHARED
    REPO_IMPL -->|implements| REPO_I
    REPO_IMPL -->|imports| ENT
    REPO_IMPL -->|imports| MODELS
    REPO_IMPL -->|imports| SHARED
    FACTORY -->|imports| REPO_I
    FACTORY -->|imports| REPO_IMPL
    FACTORY -->|imports| SHARED
    FACTORY -->|imports| CONFIG
    MODELS -->|imports| SHARED
    MW -->|imports| SHARED
    VAL -->|imports| SHARED
    CONFIG -->|imports| SHARED
    ENT -->|imports| SHARED

    style ROUTES fill:#e1f5fe
    style CTRL fill:#e1f5fe
    style SVC fill:#fff3e0
    style REPO_I fill:#e8f5e9
    style REPO_IMPL fill:#e8f5e9
    style ENT fill:#e8f5e9
    style SHARED fill:#f3e5f5
```

## Allowed Imports

| Source Layer                   | Can Import From                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Routes**                     | Controllers, Validation schemas                                                                                                      |
| **Controllers**                | Services (via factory), Shared utilities (`extractPagination`)                                                                       |
| **Services**                   | Repository interfaces, Domain entities, DTOs, Shared utilities (`ApiError`, `PaginationParams`, `withTransaction`)                   |
| **Repository interfaces**      | Domain entities, Shared types only (`PaginationParams`, `PaginatedResult`, `TxSession`)                                              |
| **Repository implementations** | Repository interfaces (implements), Domain entities, Mongoose models, Shared utilities                                               |
| **Domain entities**            | Shared constants and value helpers (`MAX_AMOUNT`, `DEFAULT_CURRENCY`), Domain errors                                                 |
| **DTOs**                       | Shared constants (type definitions only)                                                                                             |
| **Validation schemas**         | Shared constants (for enum values)                                                                                                   |
| **Factory**                    | Repository interfaces, Config, Shared utilities                                                                                      |
| **Providers**                  | Repository implementations, Config, Shared constants                                                                                 |
| **Shared utilities**           | External packages, other `shared/` modules, and `src/domain/errors.ts` (the error middleware must recognize `DomainValidationError`) |

## Forbidden Dependencies

These imports are **strictly forbidden** and violate the architecture:

| Forbidden Import                                     | Why                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Controller → Repository                              | Controllers must go through the service layer                          |
| Route → Service                                      | Routes wire controllers; services are not called directly from routes  |
| Service → Mongoose Model                             | Services depend on repository interfaces, not on the persistence layer |
| `src/domain/` → `src/infrastructure/` or `mongoose`  | The domain layer must not know how anything is stored                  |
| Repository → Service                                 | Repository is a lower layer; it cannot call back up to the service     |
| Domain Entity → Express                              | Entities must be framework-agnostic                                    |
| Shared → Application layer                           | Shared is a lower layer; it cannot import from `src/app/`              |
| Domain Entity → Repository                           | Entities are pure data; they don't access data stores                  |
| Any layer → `RepositoryFactory` (except controllers) | Only controllers instantiate services with factory-provided repos      |

### Documented exception

`src/app/middlewares/authRateLimitMiddleware.ts` imports `RateLimitModel` from `src/infrastructure/models/` directly. The rate-limit counter is infrastructure state with no domain entity, no service and no repository interface; routing it through the repository layer would add a contract nobody else consumes. Any new middleware that needs _domain_ data must still go through a service.

## Dependency Direction Rule

Dependencies flow **inward and downward**:

```
Routes → Controllers → Services → Repository Interfaces ← Repository Implementations
                                 → Domain Entities
                                 → DTOs
```

- Outer layers depend on inner layers, never the reverse
- The domain layer (entities, repository interfaces) has **zero** dependencies on the application or infrastructure layers
- `src/infrastructure/` is the only place that imports `mongoose`, outside `src/config/` (connection and health ping) and `src/shared/unitOfWork.ts` (session handling)
- Shared utilities are at the bottom — the only internal module they reach for is `src/domain/errors.ts`
