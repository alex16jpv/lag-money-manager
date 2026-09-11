/**
 * The contract of `POST /sync`: what a batch may carry and how each operation
 * is answered. Shared by the schema, the service and the OpenAPI document so
 * the three cannot drift.
 */
export const SYNC_MAX_OPERATIONS = 200;

// 200 operations of a few hundred bytes: the global 10 kB body cap would refuse every real batch.
export const SYNC_BODY_LIMIT = "1mb";

// D-2: the record per opId lives 30 days, not the snapshot of the result.
export const SYNC_OP_TTL_SECONDS = 30 * 86_400;

// Trap 7.5: a queue minted by an older app version must still be accepted.
export const SYNC_SUPPORTED_OP_VERSIONS: readonly number[] = [1];

export const SYNC_OP_STATUSES = [
  "applied",
  "merged",
  "duplicate",
  "conflict",
  "rejected",
  "blocked",
] as const;
export type SyncOpStatus = (typeof SYNC_OP_STATUSES)[number];

// Only these are recorded: a conflict leaves the operation pending and its opId may return.
export const SYNC_LANDED_STATUSES: readonly SyncOpStatus[] = [
  "applied",
  "merged",
  "duplicate",
];

// The write went in, but not exactly as sent. Not error codes: nothing failed.
export const SYNC_WARNINGS = ["CATEGORY_ARCHIVED_DROPPED"] as const;
export type SyncWarning = (typeof SYNC_WARNINGS)[number];

// Same names the front's queue uses (`OUTBOX_ACTIONS` in ledger-flow).
export const SYNC_ACTIONS = {
  account: ["create", "update", "archive", "restore", "setDefault"],
  category: ["create", "update", "archive", "restore"],
  transaction: ["create", "quickAdd", "update", "delete"],
  budget: [
    "create",
    "update",
    "archive",
    "restore",
    "setOverride",
    "clearOverride",
  ],
} as const;

export type SyncEntity = keyof typeof SYNC_ACTIONS;
export const SYNC_ENTITIES = Object.keys(SYNC_ACTIONS) as [
  SyncEntity,
  ...SyncEntity[],
];
export type SyncAction<E extends SyncEntity = SyncEntity> =
  (typeof SYNC_ACTIONS)[E][number];

export const describeSyncActions = (): string =>
  SYNC_ENTITIES.map((e) => `${e}: ${SYNC_ACTIONS[e].join(", ")}`).join("; ");
