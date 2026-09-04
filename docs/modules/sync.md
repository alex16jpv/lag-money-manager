# Sync Module

## What This Module Does

One read-only endpoint, `GET /sync/changes`, that feeds an **offline mirror**: every row of the user's data that changed after a given position, across the four entities and the user's own profile, ordered and paginated.

Two properties separate it from the listing endpoints, and both are the reason it exists:

1. **It reports disappearances.** Archived accounts, categories and budgets come with their `archivedAt`; deleted transactions come with a `deletedAt` that no other response carries. A client holding a local copy has no other way to learn that a row is gone — the listings simply stop returning it, which is indistinguishable from "no change".
2. **It is ordered by `(updatedAt, _id)`, not by the business date.** A row that is edited moves to the end of that order and never backwards, which is what makes "everything after X" a complete answer.

The module owns no data and no writes. It is a merge over five repositories.

## Files and Responsibilities

| File | Role |
| --- | --- |
| `src/app/routes/syncRoutes.ts` | Route definition with OpenAPI docs (`GET /sync/changes`) |
| `src/app/controllers/SyncController.ts` | Resolves the request's position: `cursor`, else `since`, else a snapshot |
| `src/app/services/SyncService.ts` | Merges the five sources into one globally ordered page and mints the next cursor |
| `src/app/validation/schemas.ts` | `syncChangesSchema` |
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

## Indexes

Every entity in the feed carries `(userId, updatedAt, _id)`. The keyset predicate is an `$or` of two branches — `updatedAt > t` and `updatedAt = t AND _id > id` — both prefixed by `userId`, so each is answered by that index already sorted and MongoDB merges them instead of sorting the page in memory.

The index has **no partial filter**: a filter on `archivedAt`/`deletedAt` would exclude exactly the rows the feed exists to report.

Adding a new entity to the sync feed means adding this index to it in the same change. It is invariant 5 of the offline contract, not an optimization.
