# Sync Module

## What This Module Does

Two endpoints for the offline client. `GET /sync/changes` feeds an **offline mirror**: every row of the user's data that changed after a given position, across the four entities and the user's own profile, ordered and paginated. `POST /sync` takes the client's **outbox as one batch** and answers one structured result per operation.

Two properties separate it from the listing endpoints, and both are the reason it exists:

1. **It reports disappearances.** Archived accounts, categories and budgets come with their `archivedAt`; deleted transactions come with a `deletedAt` that no other response carries. A client holding a local copy has no other way to learn that a row is gone — the listings simply stop returning it, which is indistinguishable from "no change".
2. **It is ordered by `(updatedAt, _id)`, not by the business date.** A row that is edited moves to the end of that order and never backwards, which is what makes "everything after X" a complete answer.

The feed owns no data and no writes: it is a merge over five repositories. The batch owns exactly one collection — the registry of landed operations (`syncops`) — and **no business rule**: every operation goes through the same service its HTTP route calls (offline plan, trap 7.8).

## Files and Responsibilities

| File | Role |
| --- | --- |
| `src/app/routes/syncRoutes.ts` | Route definitions with OpenAPI docs (`GET /sync/changes`, `POST /sync`) |
| `src/app/controllers/SyncController.ts` | Feed: resolves the request's position (`cursor`, else `since`, else a snapshot). Batch: resolves the user's timezone and hands the operations to the batch service |
| `src/app/services/SyncService.ts` | Merges the five sources into one globally ordered page and mints the next cursor |
| `src/app/services/SyncBatchService.ts` | Applies a batch in `seq` order through the account, category, transaction and budget services; blocks, remembers and classifies outcomes, and applies the reconciliation rules below |
| `src/shared/syncBatch.ts` | The batch contract: limits, statuses, warnings, actions per entity, TTL |
| `src/shared/collation.ts` | The collation of the unique name indexes, shared by the indexes and by the name lookups the reconciliation uses |
| `src/shared/errorResponse.ts` | Translates a client-fault error to `{status, body}` — used by the error middleware and by the batch, so both answer the same codes |
| `src/infrastructure/models/SyncOpModel.ts` · `repositories/syncOp/` | The registry of landed operations, one row per `opId`, 30-day TTL |
| `src/app/validation/schemas.ts` | `syncChangesSchema`, `syncBatchSchema` |
| `src/shared/syncCursor.ts` | Cursor encoding, the `(updatedAt, _id)` ordering, and the overlap window |
| `src/infrastructure/repositories/changeFeed.ts` | The keyset `$or` predicate every repository shares |
| `src/infrastructure/repositories/*/…Repository.ts` | `changesSince()` on account, category, transaction and budget |
| `src/infrastructure/models/*.ts` | The `(userId, updatedAt, _id)` index that backs all four |

## Public API

### `GET /sync/changes`

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `since` | string | No | Lower bound on `updatedAt`, **exclusive** (ISO 8601 with a time and an offset) |
| `cursor` | string | No | Opaque; a previous response's `nextCursor`, verbatim. Wins over `since` |
| `limit` | integer | No | Rows per page across **all** entities together. Default 200, maximum 1000 |

**Neither `since` nor `cursor` is a full snapshot**, down the same code path. There is deliberately no second endpoint for it: two definitions of "everything the client needs" drift apart.

**Response (200):**

```json
{
  "serverTime": "2026-09-03T21:14:05.412Z",
  "changes": {
    "user": { "id": "0195…", "name": "John Doe", "…": "…" },
    "accounts": [{ "id": "0195…", "archivedAt": null, "…": "…" }],
    "categories": [],
    "transactions": [{ "id": "0195…", "deletedAt": "2026-09-01T10:00:00.000Z", "…": "…" }],
    "budgets": []
  },
  "pagination": {
    "limit": 200,
    "count": 2,
    "hasMore": false,
    "nextCursor": "djF8MjAyNi0wOS0wM1QyMToxMzowNS40MTJafA"
  }
}
```

| Field | Meaning |
| --- | --- |
| `serverTime` | The server's clock **before** the page was read, so the watermark can never claim to cover a write that landed mid-page |
| `changes.user` | `null` when the profile did not change within this page |
| `pagination.count` | Rows in this page, all entities together |
| `pagination.nextCursor` | Never null — see below |

### Paging, and why the cursor goes backwards at the end

Send `nextCursor` back as `cursor` until `hasMore` is false. While `hasMore` is true it is the exact row the page stopped at.

**When `hasMore` is false, the cursor is deliberately 60 seconds behind `serverTime`.** `updatedAt` is stamped by the application server (Mongoose timestamps), not by MongoDB, so two instances with drifted clocks can confirm writes out of order: a row stamped `12:00:00` can become visible *after* one stamped `12:00:01`. A watermark set to the last row read would skip it forever. Rows inside that window arrive again on the next pull; the client applies by `id` with an upsert, so reprocessing them costs nothing.

The alternative — a `ChangeLog` collection with a monotonic `seq` per user — is exact and needs no window, at the price of an extra write per operation. It is not needed while data belongs to exactly one user.

### Budgets come as stored, not as the view

`GET /budgets` returns a **view**: `periodKey`, `periodFrom`/`periodTo`, `amount` resolved for the period, `spent`, `expired`. All of it is derived from a reference date and from the transactions, so none of it is state to mirror — and computing `spent` for every budget of a snapshot would be one aggregation per row. The feed returns the stored budget instead (`amount` as the base amount, plus `amountOverrides`, `periodType` and the window dates), and the client derives the view locally from the transactions it already holds.

### Errors

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION` | `since` is not ISO 8601 with a time and an offset, or `limit` is outside 1–1000 |
| 400 | `INVALID_CURSOR` | The cursor is not one this server minted |
| 401 | — | Missing or invalid token |

A cursor the server cannot read is rejected rather than treated as "start from the beginning": silently serving page one is how a client ends up looping over the same rows forever.

### `POST /sync`

Pushes the offline outbox as one batch: 1–200 operations, body up to 1 MB. The batch is **not a transaction** — each operation is applied on its own, in `seq` order (the device's counter, never the array order or `occurredAt`), and answered on its own. The response is `200` whenever the envelope is valid; what happened to each operation is in `results[i].status`.

**Request:**

```json
{
  "operations": [
    {
      "opId": "0195…a1", "seq": 12, "occurredAt": "2026-09-05T10:00:00-05:00",
      "entity": "account", "action": "create", "id": "0195…c1",
      "payload": { "body": { "name": "Nequi", "type": "OTHER", "balance": 120000 } },
      "dependsOn": [], "opVersion": 1
    },
    {
      "opId": "0195…a2", "seq": 13, "occurredAt": "2026-09-05T10:01:00-05:00",
      "entity": "transaction", "action": "create", "id": "0195…c2",
      "payload": { "body": { "type": "EXPENSE", "amount": 12500, "date": "2026-09-05T10:01:00-05:00", "fromAccountId": "0195…c1" } },
      "dependsOn": ["0195…c1"], "opVersion": 1
    },
    {
      "opId": "0195…a3", "seq": 14, "occurredAt": "2026-09-05T10:02:00-05:00",
      "entity": "budget", "action": "setOverride", "id": "0195…b7",
      "payload": { "body": { "amount": 250 }, "query": { "reference": "2026-12-15T12:00:00.000Z" } },
      "baseUpdatedAt": "2026-09-01T08:00:00.000Z", "dependsOn": [], "opVersion": 1
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `opId` | UUID minted by the device; the idempotency key of the operation |
| `seq` | The device's monotonic counter. **The only ordering criterion** |
| `occurredAt` | The device's clock. Data only; never used to order or to judge |
| `entity` · `action` | Which route: `account` create/update/archive/restore/setDefault · `category` create/update/archive/restore · `transaction` create/quickAdd/update/delete · `budget` create/update/archive/restore/setOverride/clearOverride |
| `id` | The row the operation is about: the client-minted id of a create, the row's id otherwise. A create's `payload.body.id`, if sent, must equal it |
| `payload.body` | The body the matching route takes, verbatim. Validated with **the same Zod schema the route uses**; a bad body rejects that one operation, not the batch. Ignored by actions that take none |
| `payload.query.reference` | The budget routes' `reference` (which period the view resolves and which override is set or cleared). Default: now |
| `baseUpdatedAt` | The route's `If-Match`: the `updatedAt` the device had. Absent = unconditional write, as over HTTP |
| `dependsOn` | Ids of rows created offline that this operation names (an account of a movement, a category of a budget) |
| `opVersion` | The envelope version. This server accepts `1`; another value rejects the operation |

**Response (200):**

```json
{
  "serverTime": "2026-09-05T15:02:12.412Z",
  "results": [
    { "opId": "0195…a1", "seq": 12, "entity": "account", "id": "0195…c1", "status": "applied", "result": { "id": "0195…c1", "name": "Nequi", "updatedAt": "…", "…": "…" } },
    { "opId": "0195…a2", "seq": 13, "entity": "transaction", "id": "0195…c2", "status": "applied", "result": { "…": "…" } },
    { "opId": "0195…a3", "seq": 14, "entity": "budget", "id": "0195…b7", "status": "conflict", "code": "STALE_UPDATE", "message": "The resource changed since you last read it", "current": { "…": "…" } },
    { "opId": "0195…a4", "seq": 15, "entity": "category", "id": "0195…c9", "status": "merged", "mergedInto": "0195…f1", "result": { "id": "0195…f1", "name": "Comida", "…": "…" } },
    { "opId": "0195…a5", "seq": 16, "entity": "transaction", "id": "0195…c4", "status": "applied", "warnings": ["CATEGORY_ARCHIVED_DROPPED"], "result": { "categoryId": null, "pendingDetails": true, "…": "…" } }
  ]
}
```

| `status` | Meaning | Extra fields |
| --- | --- | --- |
| `applied` | Landed now | `result`: what the route would have answered (absent for `transaction:delete`, whose route answers a message); `warnings` when it landed degraded |
| `duplicate` | Already landed: a resent `opId` (answered from the registry, no `result`), a create whose `id` the user already owns (O-B1 replay, `result` carries the row as stored), or a `transaction:delete` of a movement another device already deleted | `result` in the second case; `mergedInto` when the remembered operation was a merge |
| `merged` | A `category:create` whose name and type an **active** category of the user already has: the two are the same category, so the create landed on the server's row and the rest of the batch was redirected to it | `mergedInto`: that row's id; `result`: the row |
| `conflict` | The route would have answered **409** (`STALE_UPDATE`, `DUPLICATE`, `ID_TAKEN`), or a row the server has explains the refusal: a `DUPLICATE` whose name an active row holds, and `RESOURCE_ARCHIVED` for an account archived online | `code`, `message`, and `current` — the row as the server has it, exactly like the HTTP 409 |
| `rejected` | The route would have answered another **4xx**: `VALIDATION` (with `details`), `NOT_FOUND`, `CATEGORY_ARCHIVED`, `BUDGET_PERIOD_OVERLAP`, `FUTURE_DATE`, `DEFAULT_ACCOUNT_ARCHIVE_BLOCKED`… | `code`, `message`, `details` when the route sends them |
| `blocked` | Not attempted: a row it names — one of `dependsOn`, **or its own `id`** — had an operation fail (`conflict`, `rejected` or `blocked`) earlier in this batch | `blockedBy`: that operation's `opId` |

A code-less 404 from a route (`Account not found`) arrives as `NOT_FOUND`, the same default `PATCH /transactions/batch` uses: with no HTTP status per operation, the client needs a code to branch on. `BUDGET_PERIOD_OVERLAP` is a `rejected`, not a `conflict`: the budget routes answer it with **400**, and the batch never invents a status the route would not have.

**What the client does with each status** is the O-F5b engine's business, but the intent is: `applied` and `duplicate` leave the queue; `conflict` and `rejected` stay, shown to the user; `blocked` stays and is resent once the blocker is resolved.

**Idempotency.** Every operation that lands (`applied`, `merged`, `duplicate`) is remembered as `{opId, status, entityId, code}` for **30 days** (TTL index on `createdAt`); the same `opId` sent again answers `duplicate` from that record without touching the services — with `mergedInto` when what it landed on was another row. This is what turns "resend the whole queue after a lost response" into a no-op — including an `update` whose `If-Match` a bare `PUT` would now refuse with 409. A `conflict`, a `rejected` or a `blocked` operation is **not** remembered: it is still pending on the device, which may resend the same `opId` once fixed or rebased. After the 30 days a resend is applied again, which the client-minted ids (creates) and `baseUpdatedAt` (updates) keep safe.

**Dependencies.** An operation whose `dependsOn` names a row with no operation in this batch is not blocked — the row is assumed to be on the server already, and the service answers `NOT_FOUND` if it is not. An operation must come **after** the creation it depends on in `seq` order; the client guarantees that (offline plan, O-F4).

**Failure of the request itself.** A database outage or a bug while applying an operation fails the whole request (`503` / `500`) rather than filing it under the operation; what landed before it is on record and replays as `duplicate` when the batch is resent. The operation itself and its record are not written atomically: a crash between the two leaves an applied operation unregistered, and the resend is judged by the route's own rules (a create replays; an update meets 409). That is the same exposure a lost HTTP response has today.

### Reconciliation, per entity

What a service refuses is not always the last word: an operation queued offline can be refused for something that happened online while the device was away. These rules apply **only inside `POST /sync`** — the HTTP routes are unchanged — and they never write anything themselves, they only decide what to answer and, for a merge, which row the rest of the batch writes to.

**Categories merge by name and type.** A `category:create` whose name matches an **active** category of the user — case folded, exactly as the unique index folds it — and whose type is the same one answers `merged`: `result` is the server's category and `mergedInto` is its id. Nothing is created under the id the device minted. Every later operation of the same batch that names that id is applied against the server's row instead: its own `id` (a `category:update` queued behind the create), its `dependsOn`, and the `categoryId` / `categoryIds` of the movements and budgets in the batch. The registry stores the row it landed on, so a resend after a lost response still answers `mergedInto` — which is how the device learns to point its local row at the server's. Same name, **different type** is not the same category: that stays a `conflict` `DUPLICATE`, with the server's category in `current`.

**Accounts never merge.** Folding two accounts would rewrite balances, so a taken name stays a `conflict` `DUPLICATE` — with the server's account in `current`, so the device can offer "use the server's" without another round trip. The offline account's opening balance is never folded into anything.

**Every write that names a name carries the row that holds it.** The `current` of a `DUPLICATE` is not only the create's: an `update` that renames onto a taken name, and a `restore` of a row whose name another active row took meanwhile (with or without a `name` in its body — without one, the archived row's own name is what was refused), answer `conflict` `DUPLICATE` with that row in `current`, so the device can show who has the name and offer restoring or renaming to another. None of these merges: renaming an existing row onto another is never the same row.

**Budgets** keep the routes' own answer: an overlap is `rejected` `BUDGET_PERIOD_OVERLAP` (400 on the route, so `rejected` here).

**A reference archived online.** A movement whose category was archived while the device was offline is **saved without the category**, flagged `pendingDetails: true` so it lands in the review inbox, and answered `applied` with `warnings: ["CATEGORY_ARCHIVED_DROPPED"]`. The movement is never lost. This is the one write the batch makes that the route would not take as sent: `POST /transactions` does not accept `pendingDetails`, so a `MANUAL` movement flagged for review can only be born here — deliberately, because the review inbox is where the user meets the missing category. A **budget's** category is never dropped: a budget with no categories is a *global* budget, so dropping one would silently change what it counts — that stays `rejected` `CATEGORY_ARCHIVED`. A movement whose **account** was archived online is a `conflict` `RESOURCE_ARCHIVED` with the archived account in `current`: the route answers a bare 404 there, which cannot tell "archived while I was away" from "never existed", and only the first is the user's to resolve (restore the account, or move the movement).

**Already gone.** Archiving a row that is already archived lands (`applied`): the state the operation wanted holds, and archives are idempotent on the routes too. Deleting a movement that another device already deleted answers `duplicate` rather than the route's 404 — same reasoning, and the queue drains instead of filling the tray with movements the user already removed.

**`setDefault` is not last-write-wins.** ESTRATEGIA §5.4 proposed resolving two devices' `setDefault` by `occurredAt`; it is not implemented, on purpose. `occurredAt` is the device's clock and this contract never judges by it (trap 7.4): the batch that reaches the server last wins, as with any other write.

**Dates** are judged by the server's clock, against the movement's own date: `FUTURE_DATE` (more than 24 h ahead) is `rejected` no matter what `occurredAt` says, which is what a phone whose clock runs ahead gets.

**Errors of the envelope (nothing applied):**

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION` | Empty batch, more than 200 operations, a repeated `opId`, a malformed field of the envelope |
| 401 | — | Missing or invalid token |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 1 MB |

## Indexes

Every entity in the feed carries `(userId, updatedAt, _id)`. The keyset predicate is an `$or` of two branches — `updatedAt > t` and `updatedAt = t AND _id > id` — both prefixed by `userId`, so each is answered by that index already sorted and MongoDB merges them instead of sorting the page in memory.

The index has **no partial filter**: a filter on `archivedAt`/`deletedAt` would exclude exactly the rows the feed exists to report.

Adding a new entity to the sync feed means adding this index to it in the same change. It is invariant 5 of the offline contract, not an optimization.

`syncops` carries a TTL index on `createdAt` (`expireAfterSeconds` = 30 days) and is keyed by `${userId}:${opId}`, so two users' opIds can never collide and the lookup per operation is a primary-key read.

## What the offline client still needs outside this module

The web client mirrors the feed of this module and answers its screens from that copy, so those screens no longer call the endpoints below on every render. **They must not be retired for that reason.**

| Endpoint | Why it stays |
| --- | --- |
| `GET /stats/spending` | The client derives its spending buckets from the mirror and checks that derivation against the parity fixtures this repository produces. This endpoint is the reference those fixtures come from, and the answer for any grouping or range the mirror does not hold |
| `GET /transactions`, `/accounts`, `/categories`, `/budgets` | The mirror is the client's primary path, not its only one: with no vault yet, or before the first snapshot has drained, it falls back to these. A device that has just signed in reads nothing else |

Retiring or reshaping any of them is a breaking change for the client even when its screens look quiet. It goes through the owner first.

