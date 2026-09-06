import { Router } from "express";

import { SyncController } from "../controllers/SyncController";
import { syncBatchSchema, syncChangesSchema } from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /sync/changes:
 *   get:
 *     tags: [Sync]
 *     summary: Everything that changed for the user, for the offline mirror
 *     description: |
 *       One feed for the four entities and the user, ordered by
 *       `(updatedAt, _id)` and paginated with an opaque cursor. **Archived and
 *       deleted rows are included** — they are the only way a client that is
 *       holding a local copy learns that something disappeared. Deleted
 *       transactions arrive with `deletedAt` set; archived accounts,
 *       categories and budgets with `archivedAt`.
 *
 *       **No `since` and no `cursor` is a full snapshot**, down the same code
 *       path: there is no separate snapshot endpoint to drift from this one.
 *
 *       **Budgets come as stored, not as the view `GET /budgets` returns.**
 *       The view's `spent`, `periodKey` and `periodFrom`/`periodTo` are derived
 *       from a reference date and from the transactions, so they are not state
 *       to mirror; the client derives them locally from what it already has.
 *
 *       **How to page.** Send the previous response's `nextCursor` back
 *       verbatim, until `hasMore` is false. The cursor of a finished run is
 *       deliberately **60 seconds behind `serverTime`**: `updatedAt` is stamped
 *       by the application server, not by MongoDB, so instances with drifted
 *       clocks can confirm writes out of order. Rows in that overlap arrive
 *       twice; applying by `id` with an upsert makes that free, and it is what
 *       stops a write from being missed forever.
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *         description: |
 *           Lower bound on `updatedAt`, EXCLUSIVE (ISO 8601 with a time and an
 *           offset). Ignored when `cursor` is also sent — the cursor is the
 *           more precise position of the two.
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *         description: |
 *           Opaque; the `nextCursor` of a previous response, verbatim. A
 *           malformed one is `400 INVALID_CURSOR`, never a silent page one.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 1000, default: 200 }
 *         description: |
 *           Rows per page across ALL entities together, not per entity.
 *     responses:
 *       200:
 *         description: One page of changes
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncChangesResponse'
 *       400:
 *         description: |
 *           Invalid query parameters (code VALIDATION) or an unreadable cursor
 *           (code INVALID_CURSOR)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/changes", validate(syncChangesSchema), SyncController.getChanges);

/**
 * @openapi
 * /sync:
 *   post:
 *     tags: [Sync]
 *     summary: Push the offline outbox as one batch
 *     description: |
 *       Applies up to 200 queued write operations in `seq` order, each one
 *       through **the same service the matching HTTP route calls** — no rule
 *       lives here that the routes do not enforce — and answers **one result
 *       per operation**. The batch is not a transaction: the response is
 *       `200` whenever the envelope is valid, and each operation's `status`
 *       says what happened to it.
 *
 *       | status | meaning | what the client does |
 *       |---|---|---|
 *       | `applied` | landed now; `result` is what the route would have answered | drop the operation, keep `result` |
 *       | `duplicate` | already landed: a resent `opId`, or a create whose `id` the user already owns (`result` carries the row in that case) | drop the operation |
 *       | `conflict` | the route would have answered 409: `STALE_UPDATE` (with `current`), `DUPLICATE`, `BUDGET_PERIOD_OVERLAP`, `ID_TAKEN` | keep it; resolve |
 *       | `rejected` | the route would have answered another 4xx (`VALIDATION`, `NOT_FOUND`, `RESOURCE_ARCHIVED`, `CATEGORY_ARCHIVED`, `FUTURE_DATE`…) | keep it; the user fixes or discards |
 *       | `blocked` | a row it names (`dependsOn`, or its own `id`) had an operation fail earlier in this batch; `blockedBy` is that opId | keep it; resend once the blocker is resolved |
 *       | `merged` | reserved for the per-entity reconciliation rules (not produced yet) | — |
 *
 *       **Actions per entity:** account: create, update, archive, restore,
 *       setDefault · category: create, update, archive, restore · transaction:
 *       create, quickAdd, update, delete · budget: create, update, archive,
 *       restore, setOverride, clearOverride. `payload.body` is the body the
 *       matching route takes, validated with the same rules (a bad body
 *       rejects that operation only); `payload.query.reference` is the budget
 *       routes' `reference`; `baseUpdatedAt` is the route's `If-Match`. A
 *       create's `payload.body.id`, if sent, must equal `id`.
 *
 *       **Idempotency:** every landed `opId` is remembered for 30 days; sending
 *       it again answers `duplicate` without applying anything. A conflict or
 *       a rejection is not remembered — the operation is still pending on the
 *       device, which may resend it once fixed.
 *
 *       **Limits:** 1–200 operations, body up to 1 MB, `opVersion` 1.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SyncBatchInput'
 *     responses:
 *       200:
 *         description: One result per operation, in `seq` order
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncBatchResponse'
 *       400:
 *         description: |
 *           The envelope is invalid (code VALIDATION): empty or too long, a
 *           repeated opId, a malformed field. Nothing was applied.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       413:
 *         description: Body over 1 MB (code PAYLOAD_TOO_LARGE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/", validate(syncBatchSchema), SyncController.push);

export default router;
