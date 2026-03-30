# Error Handling Reference

## Global Error Handling Strategy

All errors in the application are handled by a single global error middleware registered at the end of the Express middleware chain in `src/app.ts`. This ensures consistent error response formatting across all endpoints.

**Error middleware location:** `src/shared/middlewares.ts`

**Flow:**

1. Any thrown error or rejected Promise in a controller/service/middleware is caught
2. The error middleware identifies the error type
3. A structured JSON response is sent with the appropriate HTTP status code
4. Unknown errors are logged with the request ID for traceability

## Custom Error Classes

### `ApiError` (`src/shared/errors.ts`)

The primary error class for expected/handled error conditions in the service layer.

```typescript
class BaseError extends Error {
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ApiError extends BaseError {
  static errors = {
    BadRequest: 400,
    Unauthorized: 401,
    Forbidden: 403,
    NotFound: 404,
    UnprocessableEntity: 422,
    InternalServerError: 500,
  };

  constructor(
    name: keyof typeof ApiError.errors,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(message || name, ApiError.errors[name], details);
    this.name = name + "Error";
  }
}
```

**Usage:**

```typescript
throw new ApiError("NotFound", "Transaction not found");
throw new ApiError("Forbidden", "Access denied");
throw new ApiError("BadRequest", "Transaction id does not match");
throw new ApiError("Unauthorized", "Invalid or expired token");
```

### `DomainValidationError` (`src/domain/errors.ts`)

For domain-level validation errors within entities.

```typescript
export class DomainValidationError extends Error {
  field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "DomainValidationError";
    this.field = field;
  }
}
```

## Error Response Formats

### ApiError response

```json
{
  "error": "NotFoundError",
  "message": "Transaction not found",
  "details": {}
}
```

### DomainValidationError response

```json
{
  "error": "ValidationError",
  "message": "Invalid field value",
  "details": { "field": "amount" }
}
```

### Zod validation error response (from validation middleware)

```json
{
  "error": "ValidationError",
  "message": "Invalid request data",
  "details": [
    { "field": "body.amount", "message": "Amount must be greater than 0" },
    {
      "field": "body.fromAccountId",
      "message": "fromAccountId is required for expense transactions"
    }
  ]
}
```

### Sequelize unique constraint violation

```json
{
  "error": "ConflictError",
  "message": "email must be unique"
}
```

### Sequelize foreign key constraint violation

```json
{
  "error": "ValidationError",
  "message": "Foreign key constraint error",
  "details": { "fields": "categoryId" }
}
```

### MongoDB duplicate key (code 11000)

```json
{
  "error": "ConflictError",
  "message": "Duplicate value for: email"
}
```

### Mongoose CastError (invalid ObjectId)

```json
{
  "error": "ValidationError",
  "message": "Invalid ID format"
}
```

### Unknown/unhandled error

```json
{
  "error": "InternalServerError",
  "message": "An unexpected error occurred"
}
```

## HTTP Status Code Conventions

| Status | Meaning               | Used When                                       |
| ------ | --------------------- | ----------------------------------------------- |
| 200    | OK                    | Successful GET or PUT                           |
| 201    | Created               | Successful POST (resource created)              |
| 204    | No Content            | Successful DELETE                               |
| 400    | Bad Request           | Validation failure, ID mismatch, invalid format |
| 401    | Unauthorized          | Missing/invalid/expired JWT token               |
| 403    | Forbidden             | User doesn't own the requested resource         |
| 404    | Not Found             | Resource doesn't exist                          |
| 409    | Conflict              | Duplicate unique constraint (email, etc.)       |
| 422    | Unprocessable Entity  | Request understood but semantically invalid     |
| 429    | Too Many Requests     | Rate limit exceeded                             |
| 500    | Internal Server Error | Unexpected/unhandled error                      |

## How to Add a New Error Type

1. If it maps to an existing HTTP status code already in `ApiError.errors`, just use `ApiError`:

   ```typescript
   throw new ApiError("BadRequest", "Your specific message");
   ```

2. If you need a new HTTP status code, add it to `ApiError.errors`:

   ```typescript
   static errors = {
     // ... existing
     PaymentRequired: 402,
   };
   ```

3. If you need a new database-specific error handler, add a new `if` block in `src/shared/middlewares.ts`:
   ```typescript
   if (error?.name === "YourSpecificError") {
     res.status(XXX).json({ error: "...", message: "..." });
     return;
   }
   ```

## Logging Behavior on Errors

- **Expected errors** (ApiError, DomainValidationError, DB constraints): Not logged. They return structured responses.
- **Unexpected errors** (500): Logged at `error` level with the full error object and `X-Request-Id` for correlation:
  ```typescript
  logger.error(
    { err: error, requestId: req.headers["x-request-id"] },
    "Unhandled error",
  );
  ```
- **Logging library:** Pino (structured JSON in production, pretty-printed in development)
