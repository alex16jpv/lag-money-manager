/**
 * Every machine-readable error code the API can return.
 *
 * `ApiError` and `DomainValidationError` type their `code` against this, so a
 * new code cannot reach a client without being declared here — the compiler,
 * not a convention, is what keeps the list complete. The OpenAPI schema
 * publishes it, which lets the frontend derive its own union instead of
 * transcribing one.
 */
export const ERROR_CODES = [
  // Generic
  "VALIDATION",
  "INTERNAL",
  "DUPLICATE",
  "INVALID_ID",
  "INVALID_CURSOR",
  "RESOURCE_ARCHIVED",
  "DB_UNAVAILABLE",
  "RATE_LIMITED",
  // Request body rejected before routing (body-parser)
  "MALFORMED_JSON",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_ENCODING",
  "REQUEST_ABORTED",
  "BAD_REQUEST",
  // Auth and users
  "EMAIL_TAKEN",
  "REFRESH_INVALID",
  "REFRESH_REVOKED",
  "CURRENT_PASSWORD_INVALID",
  // Money and currency
  "CURRENCY_LOCKED",
  "CURRENCY_MISMATCH",
  "AMOUNT_PRECISION",
  "FUTURE_DATE",
  // Accounts
  "ACCOUNT_LIMIT_REACHED",
  "DEFAULT_ACCOUNT_ARCHIVE_BLOCKED",
  "NO_DEFAULT_ACCOUNT",
  // Categories
  "CATEGORY_LIMIT_REACHED",
  "CATEGORY_ARCHIVED",
  "CATEGORY_TYPE_LOCKED",
  "CATEGORY_TYPE_MISMATCH",
  // Budgets
  "BUDGET_PERIOD_OVERLAP",
  // Idempotency
  "IDEMPOTENCY_KEY_INVALID",
  "IDEMPOTENCY_PAYLOAD_MISMATCH",
  "IDEMPOTENCY_ORIGINAL_DELETED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
