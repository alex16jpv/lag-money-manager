import { Router } from "express";

import { SyncController } from "../controllers/SyncController";
import { syncChangesSchema } from "../validation/schemas";
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

export default router;
