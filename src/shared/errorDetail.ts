const ADDRESS = /[^\s@<>"'(),;:[\]]+@[^\s@<>"'(),;:[\]]+\.[^\s@<>"'(),;:[\]]+/g;
const ACCESS_KEY_ID = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const LONG_TOKEN = /[A-Za-z0-9+/=_-]{32,}/g;
const MAX_DETAIL_LENGTH = 300;
const MAX_SCANNED_LENGTH = 4 * MAX_DETAIL_LENGTH;

const UNSENT_NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);
const PRE_REQUEST_SYSCALLS = new Set(["getaddrinfo", "connect"]);

interface SystemFields {
  code?: unknown;
  syscall?: unknown;
  errors?: unknown;
  cause?: unknown;
}

function fieldsOf(err: unknown): SystemFields | undefined {
  return typeof err === "object" && err !== null
    ? (err as SystemFields)
    : undefined;
}

function systemCode(err: unknown): string | undefined {
  const fields = fieldsOf(err);
  if (typeof fields?.code === "string") return fields.code;
  const inner = fieldsOf(fields?.cause)?.code;
  return typeof inner === "string" ? inner : undefined;
}

function stoppedBeforeTheRequest(err: unknown): boolean {
  const fields = fieldsOf(err);
  if (!fields) return false;
  if (Array.isArray(fields.errors) && fields.errors.length > 0) {
    return fields.errors.every(stoppedBeforeTheRequest);
  }
  return (
    typeof fields.code === "string" &&
    UNSENT_NETWORK_CODES.has(fields.code) &&
    typeof fields.syscall === "string" &&
    PRE_REQUEST_SYSCALLS.has(fields.syscall)
  );
}

function redact(text: string): string {
  return text
    .split("\n", 1)[0]
    .slice(0, MAX_SCANNED_LENGTH)
    .replace(ADDRESS, "[address]")
    .replace(ACCESS_KEY_ID, "[key]")
    .replace(LONG_TOKEN, "[token]");
}

export function neverLeft(err: unknown): boolean {
  return (
    stoppedBeforeTheRequest(err) ||
    stoppedBeforeTheRequest(fieldsOf(err)?.cause)
  );
}

export function describeError(
  err: unknown,
  httpStatus?: number,
): string | undefined {
  if (err === undefined || err === null) return undefined;
  if (!(err instanceof Error)) {
    return redact(String(err)).slice(0, MAX_DETAIL_LENGTH) || undefined;
  }
  const { cause: inner } = err as { cause?: unknown };
  const cause =
    inner instanceof Error && inner.message !== err.message
      ? inner.message
      : undefined;
  const parts = [
    systemCode(err),
    httpStatus === undefined ? undefined : `HTTP ${httpStatus}`,
    err.message ? redact(err.message) : undefined,
    cause ? redact(cause) : undefined,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return undefined;
  return parts.join(" · ").slice(0, MAX_DETAIL_LENGTH);
}
