import { Router } from "express";

import { SharedExpenseController } from "../controllers/SharedExpenseController";
import { SharedGroupController } from "../controllers/SharedGroupController";
import {
  addParticipantsSchema,
  createSharedExpenseSchema,
  createSharedGroupSchema,
  getSharedExpensesSchema,
  getSharedGroupsSchema,
  idParamSchema,
  removeParticipantSchema,
  restoreSchema,
  sharedExpenseParamsSchema,
  undoWriteOffSchema,
  updateSharedExpenseSchema,
  updateSharedGroupSchema,
  writeOffSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /shared-groups:
 *   get:
 *     tags: [Shared groups]
 *     summary: Get all shared groups
 *     description: >
 *       An outing, a dinner or a two-month trip: a shared group has **no
 *       period**. Its expenses carry the dates, and `totals.dateFrom` and
 *       `totals.dateTo` are derived from them, never stored. Archived groups
 *       are hidden unless includeArchived=true.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *         description: Maximum number of items to return
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *         description: Number of items to skip (offset-based pagination)
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *         description: ID of the last item of the previous page; must name a row of the caller's (overrides offset)
 *       - in: query
 *         name: ids
 *         schema: { type: string }
 *         description: Comma-separated list of group UUIDs to filter by ID (1-100)
 *       - in: query
 *         name: contactId
 *         schema: { type: string, format: uuid }
 *         description: Only the groups this contact takes part in
 *       - in: query
 *         name: includeArchived
 *         schema: { type: string, enum: [true, false] }
 *         description: Include archived groups in the listing
 *     responses:
 *       200:
 *         description: Paginated list of shared groups with their totals
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroupList'
 *       400:
 *         description: Invalid query parameters (code VALIDATION), or a cursor that names no group of the caller's (code INVALID_CURSOR)
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
router.get(
  "/",
  validate(getSharedGroupsSchema),
  SharedGroupController.getAllGroups,
);

/**
 * @openapi
 * /shared-groups:
 *   post:
 *     tags: [Shared groups]
 *     summary: Create a shared group
 *     description: >
 *       Requires `name`; active group names are unique per user,
 *       case-insensitively. `contactIds` names the other people in it — you are
 *       always a participant and are never listed there. A group holds at most
 *       `SharedLimits.maxParticipantsPerGroup` people, you included (400
 *       PARTICIPANT_LIMIT_REACHED).
 *
 *       `defaultSplit` is the split a new expense **inherits**, not a rule. It
 *       is `EQUAL` or `PERCENT` only: a default has no total to divide, so
 *       `EXACT` and `FIXED_REST` are things only an expense can carry. Under
 *       `PERCENT` it needs one `shares` entry per participant — `contactId:
 *       null` is you — adding up to 100, or 400 SPLIT_INVALID.
 *
 *       Accepts a client-minted `id`, with the usual replay.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSharedGroupInput'
 *     responses:
 *       200:
 *         description: Replay of a create already made with this client-minted id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroup'
 *       201:
 *         description: Shared group created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroup'
 *       400:
 *         description: Validation error (code VALIDATION), too many people (code PARTICIPANT_LIMIT_REACHED), the same person twice (code PARTICIPANT_ALREADY_IN_GROUP) or a default split that does not add up (code SPLIT_INVALID)
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
 *       404:
 *         description: One of the `contactIds` is not an active contact of the caller's
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An active group with this name already exists (code DUPLICATE), or the client-minted id is already in use (code ID_TAKEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/",
  validate(createSharedGroupSchema),
  SharedGroupController.createGroup,
);

/**
 * @openapi
 * /shared-groups/{id}:
 *   get:
 *     tags: [Shared groups]
 *     summary: Get a shared group by ID
 *     description: Also resolves archived groups; only the listing hides them by default.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *     responses:
 *       200:
 *         description: Shared group found (may be archived)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroup'
 *       400:
 *         description: Invalid ID format (code VALIDATION)
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
 *       404:
 *         description: Shared group not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id", validate(idParamSchema), SharedGroupController.getGroupById);

/**
 * @openapi
 * /shared-groups/{id}:
 *   put:
 *     tags: [Shared groups]
 *     summary: Update a shared group
 *     description: >
 *       Partial update of `name`, `color` and `defaultSplit`. **Changing the
 *       default split is never retroactive**: it applies to the expenses added
 *       from then on and to nothing already recorded. Re-splitting what is
 *       already there would re-impute every payment and move what counts as
 *       yours between months, closed ones included; the deliberate version of
 *       that is `POST /shared-groups/{id}/participants`, which shows the whole
 *       result first.
 *
 *       Participants are not changed here: they have their own endpoints.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateSharedGroupInput'
 *     responses:
 *       200:
 *         description: Shared group updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroup'
 *       400:
 *         description: Validation error (code VALIDATION), group is archived (code RESOURCE_ARCHIVED) or a default split that does not add up (code SPLIT_INVALID)
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
 *       404:
 *         description: Shared group not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Another active group already uses this name (code DUPLICATE), or the resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroupConflict'
 */
router.put(
  "/:id",
  validate(updateSharedGroupSchema),
  SharedGroupController.updateGroup,
);

/**
 * @openapi
 * /shared-groups/{id}:
 *   delete:
 *     tags: [Shared groups]
 *     summary: Archive a shared group (soft delete)
 *     description: >
 *       Idempotent — archiving an already-archived group answers it unchanged.
 *       Its expenses are not touched and stay readable.
 *
 *       **What people still owe here is written off on your behalf**, which
 *       moves no figure: it was counted as yours the day it left. The answer
 *       carries it in `totals.writtenOff`, and every movement it touches says
 *       so in its history. A write-off can be taken back while the group is
 *       open, so archiving is where that stops.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     responses:
 *       200:
 *         description: The archived group (also when it was already archived)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroup'
 *       400:
 *         description: Invalid ID format (code VALIDATION)
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
 *       404:
 *         description: Shared group not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroupConflict'
 */
router.delete(
  "/:id",
  validate(idParamSchema),
  SharedGroupController.deleteGroup,
);

/**
 * @openapi
 * /shared-groups/{id}/restore:
 *   post:
 *     tags: [Shared groups]
 *     summary: Restore an archived shared group, optionally under a new name
 *     description: Idempotent — restoring an already-active group answers it unchanged.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RestoreInput'
 *     responses:
 *       200:
 *         description: Shared group restored (or already active)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroup'
 *       400:
 *         description: Invalid ID format (code VALIDATION)
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
 *       404:
 *         description: Shared group not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An active group took this name while it was archived (code DUPLICATE), or the resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroupConflict'
 */
router.post(
  "/:id/restore",
  validate(restoreSchema),
  SharedGroupController.restoreGroup,
);

/**
 * @openapi
 * /shared-groups/{id}/participants/preview:
 *   post:
 *     tags: [Shared groups]
 *     summary: Work out what adding people would do, without doing it
 *     description: >
 *       The same body as the write below, answered without touching anything:
 *       what each person is down for now and what they would be down for
 *       after, and how many expenses would be split again. The screen shows
 *       this before it asks for a confirmation, because **it is the whole
 *       group or none of it**.
 *
 *       `expenses.untouched` counts the expenses this leaves alone: the ones
 *       carrying their own `PERCENT` or `EXACT` split, where a percentage or an
 *       amount for somebody who was not there would be invented rather than
 *       derived. Everything else is split again, including the expenses that
 *       follow the group's default.
 *
 *       What each person has already paid, who ends up ahead of what they owe,
 *       and what a written-off amount becomes are not in this answer yet: none
 *       of it exists on the server until payments and write-offs do.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddParticipantsInput'
 *     responses:
 *       200:
 *         description: What the change would do
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AddParticipantsPreview'
 *       400:
 *         description: Validation error (code VALIDATION), too many people (code PARTICIPANT_LIMIT_REACHED), somebody already in the group (code PARTICIPANT_ALREADY_IN_GROUP), the group is archived (code RESOURCE_ARCHIVED), or a percentage group whose new percentages are missing or do not add up (code SPLIT_INVALID)
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
 *       404:
 *         description: Shared group not found, or one of the `contactIds` is not an active contact of the caller's
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/participants/preview",
  validate(addParticipantsSchema),
  SharedGroupController.previewParticipants,
);

/**
 * @openapi
 * /shared-groups/{id}/participants:
 *   post:
 *     tags: [Shared groups]
 *     summary: Add people to a shared group
 *     description: >
 *       `applyToExistingExpenses` off — the default — puts them in what you add
 *       from now on and in none of what is there. On, it is **the whole group
 *       or none of it**, and the answer carries the same summary the preview
 *       gave, so the caller can show what actually happened.
 *
 *       A group that splits by percentage needs `defaultSplit` with the new
 *       percentages: the old ones no longer cover everybody. The group and
 *       every expense it splits again move together, in one transaction.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddParticipantsInput'
 *     responses:
 *       200:
 *         description: The group as it now is, and what the change did
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AddParticipantsResult'
 *       400:
 *         description: Validation error (code VALIDATION), too many people (code PARTICIPANT_LIMIT_REACHED), somebody already in the group (code PARTICIPANT_ALREADY_IN_GROUP), the group is archived (code RESOURCE_ARCHIVED), or a percentage group whose new percentages are missing or do not add up (code SPLIT_INVALID)
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
 *       404:
 *         description: Shared group not found, or one of the `contactIds` is not an active contact of the caller's
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroupConflict'
 */
router.post(
  "/:id/participants",
  validate(addParticipantsSchema),
  SharedGroupController.addParticipants,
);

/**
 * @openapi
 * /shared-groups/{id}/participants/{contactId}:
 *   delete:
 *     tags: [Shared groups]
 *     summary: Take somebody out of a shared group
 *     description: >
 *       Only offered while they have **no share in any expense of the group**.
 *       Once one exists, taking them out would have to either delete money or
 *       hand their share to everybody else in silence, so the answer is 400
 *       PARTICIPANT_IN_USE and the screen offers to settle or to write off
 *       instead.
 *
 *       In a group that splits by percentage, their percentage is spread over
 *       the rest in proportion so the default still adds up to 100.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: The contact to take out
 *       - $ref: '#/components/parameters/IfMatch'
 *     responses:
 *       200:
 *         description: The group without that person
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroup'
 *       400:
 *         description: Invalid ID format (code VALIDATION), they are not in the group (code PARTICIPANT_NOT_IN_GROUP), they hold a share of an expense (code PARTICIPANT_IN_USE) or the group is archived (code RESOURCE_ARCHIVED)
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
 *       404:
 *         description: Shared group not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroupConflict'
 */
router.delete(
  "/:id/participants/:contactId",
  validate(removeParticipantSchema),
  SharedGroupController.removeParticipant,
);

/**
 * @openapi
 * /shared-groups/{id}/write-offs:
 *   post:
 *     tags: [Shared groups]
 *     summary: Give up on what somebody still owes you here
 *     description: >
 *       **It moves no figure.** That money was counted as yours the day it
 *       left your account, which is the whole answer to "and if nobody ever
 *       pays me?" — nothing has to happen. What it writes is the decision and
 *       a line in the history of every movement it touches, and what is still
 *       open stops being owed: `totals.owedToYou` drops by it,
 *       `totals.writtenOff` carries it, and the group reads `SETTLED` once
 *       nobody is left owing.
 *
 *       It names **one person** (`contactId`) or **one block of guests**
 *       (`expenseId`, the expense it lives in). Somebody who had paid part of
 *       it keeps that part. It follows the share down if a re-split ever
 *       lowers it, because what is written off is what is open, not a figure.
 *
 *       Idempotent, and undone with `DELETE` while the group is open.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WriteOffInput'
 *     responses:
 *       200:
 *         description: The group, with what it now counts as owed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroup'
 *       400:
 *         description: Validation error (code VALIDATION), somebody who is not in the group (code PARTICIPANT_NOT_IN_GROUP) or an archived group (code RESOURCE_ARCHIVED)
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
 *       404:
 *         description: Shared group or expense not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroupConflict'
 */
router.post(
  "/:id/write-offs",
  validate(writeOffSchema),
  SharedGroupController.writeOff,
);

/**
 * @openapi
 * /shared-groups/{id}/write-offs/{partyId}:
 *   delete:
 *     tags: [Shared groups]
 *     summary: Take back a write-off
 *     description: >
 *       What they owe is owed again, and the history says so. Idempotent, and
 *       only while the group is open: archiving one writes off what is left on
 *       your behalf, and that is where it stops being undoable.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: The contact, or the expense whose block of guests it was
 *       - $ref: '#/components/parameters/IfMatch'
 *     responses:
 *       200:
 *         description: The group, with what it now counts as owed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroup'
 *       400:
 *         description: Invalid ID format (code VALIDATION) or an archived group (code RESOURCE_ARCHIVED)
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
 *       404:
 *         description: Shared group not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedGroupConflict'
 */
router.delete(
  "/:id/write-offs/:partyId",
  validate(undoWriteOffSchema),
  SharedGroupController.undoWriteOff,
);

/**
 * @openapi
 * /shared-groups/{id}/expenses:
 *   get:
 *     tags: [Shared groups]
 *     summary: The expenses of a shared group
 *     description: >
 *       Newest first, keyset over `(date, id)`: ids are minted when the expense
 *       is recorded, not on the day it was spent, so they cannot order this
 *       list on their own. Deleted expenses are not listed.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *         description: Maximum number of items to return
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *         description: Number of items to skip (offset-based pagination)
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *         description: ID of the last item of the previous page; must name a row of the caller's (overrides offset)
 *     responses:
 *       200:
 *         description: Paginated list of the group's expenses
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedExpenseList'
 *       400:
 *         description: Invalid query parameters (code VALIDATION), or a cursor that names no expense of the caller's (code INVALID_CURSOR)
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
 *       404:
 *         description: Shared group not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:id/expenses",
  validate(getSharedExpensesSchema),
  SharedExpenseController.getExpenses,
);

/**
 * @openapi
 * /shared-groups/{id}/expenses:
 *   post:
 *     tags: [Shared groups]
 *     summary: Record an expense in a shared group
 *     description: >
 *       `paidByContactId` names who fronted the money; absent or null is you.
 *       Somebody else's line is **not your expense**: no movement of yours
 *       exists for it, and it becomes one the day you settle with them.
 *
 *       Leave `split` out and the expense **inherits the group's default
 *       split**, without asking. Send one and the expense carries its own, and
 *       reads as a custom split from then on. A split states a `mode` and one
 *       share per party: `USER` is you, `CONTACT` names a participant, and
 *       `GUESTS` is the block whose head count sits in `guests` — it weighs
 *       that many parts and is one party to collect from. Shares need not cover
 *       every participant: leaving somebody out of one expense is what an
 *       expense's own split is for.
 *
 *       **The odd minor unit goes to whoever paid**, in every mode, so the
 *       shares add up to the expense exactly. The split is resolved the same
 *       way whatever order the shares arrive in, because the offline projection
 *       has to reach the same figures to the peso.
 *
 *       **`transactionId` makes the expense a movement of yours.** The amount,
 *       the date and the description are then that transaction's, so sending
 *       any of the three alongside it is 400 VALIDATION — two places stating
 *       the same thing is how they end up disagreeing — and so is a
 *       `paidByContactId` other than null: a movement of yours is a line you
 *       paid. The transaction keeps the link, along with what counts as yours
 *       and the history that explains it; from then on those three are
 *       changed on the transaction, not here. Leave `transactionId` out and
 *       the expense is a fact with no money of yours behind it, which is what
 *       a line somebody else paid is.
 *
 *       Accepts a client-minted `id`, with the usual replay.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSharedExpenseInput'
 *     responses:
 *       200:
 *         description: Replay of a create already made with this client-minted id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedExpense'
 *       201:
 *         description: Expense recorded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedExpense'
 *       400:
 *         description: Validation error (code VALIDATION), a split that cannot describe one (code SPLIT_INVALID), somebody in the split who is not in the group (code PARTICIPANT_NOT_IN_GROUP), a date more than 24h ahead (code FUTURE_DATE), decimals in a `ZeroDecimalCurrency` (code AMOUNT_PRECISION), an archived group (code RESOURCE_ARCHIVED), a movement that is already in a group (code TRANSACTION_ALREADY_SHARED), one that is not an expense (code TRANSACTION_NOT_SPLITTABLE) or one in another currency (code CURRENCY_MISMATCH)
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
 *       404:
 *         description: Shared group not found, or a `transactionId` that names no movement of the caller's (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The client-minted id is already in use (code ID_TAKEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/expenses",
  validate(createSharedExpenseSchema),
  SharedExpenseController.createExpense,
);

/**
 * @openapi
 * /shared-groups/{id}/expenses/{expenseId}:
 *   get:
 *     tags: [Shared groups]
 *     summary: Get one expense of a shared group
 *     description: Also resolves a deleted expense; only the listing hides it.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared expense ID
 *     responses:
 *       200:
 *         description: The expense (may be deleted)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedExpense'
 *       400:
 *         description: Invalid ID format (code VALIDATION)
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
 *       404:
 *         description: Shared expense not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:id/expenses/:expenseId",
  validate(sharedExpenseParamsSchema),
  SharedExpenseController.getExpenseById,
);

/**
 * @openapi
 * /shared-groups/{id}/expenses/{expenseId}:
 *   put:
 *     tags: [Shared groups]
 *     summary: Edit an expense of a shared group
 *     description: >
 *       Partial update. `split` saves a split on this expense and nothing else,
 *       and marks it custom; `useGroupSplit: true` clears that and the expense
 *       follows the group's default again, from that moment on. The two cannot
 *       come together.
 *
 *       Changing the amount or who paid resolves the shares again on the split
 *       the expense already had, rather than leaving figures that no longer add
 *       up to it. The one case that cannot be resolved that way is an expense
 *       carrying its own `EXACT` split: it states amounts, so a new `amount`
 *       alone makes them stop adding up and the answer is 400 SPLIT_INVALID —
 *       send the split again with the new figures. Rescaling what somebody
 *       typed would be the server deciding what they meant.
 *
 *       **An expense that is a movement of yours takes only the split here.**
 *       Its amount, date, description and payer come from that transaction, so
 *       restating one of them is 400 SHARED_EXPENSE_LINKED: two places stating
 *       the same figure is how they end up disagreeing. Saving a split on it
 *       leaves a line in the transaction's history saying the split changed
 *       and what counts as yours did not.
 *
 *       The expense has to belong to the group in the path: reaching one of
 *       your own expenses through another of your groups answers 404.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared expense ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateSharedExpenseInput'
 *     responses:
 *       200:
 *         description: Expense updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedExpense'
 *       400:
 *         description: Validation error (code VALIDATION), a split that cannot describe one (code SPLIT_INVALID), somebody in the split who is not in the group (code PARTICIPANT_NOT_IN_GROUP), a date more than 24h ahead (code FUTURE_DATE), decimals in a `ZeroDecimalCurrency` (code AMOUNT_PRECISION), restating what the linked movement states (code SHARED_EXPENSE_LINKED), or the expense is deleted or its group archived (code RESOURCE_ARCHIVED)
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
 *       404:
 *         description: Shared expense not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedExpenseConflict'
 */
router.put(
  "/:id/expenses/:expenseId",
  validate(updateSharedExpenseSchema),
  SharedExpenseController.updateExpense,
);

/**
 * @openapi
 * /shared-groups/{id}/expenses/{expenseId}:
 *   delete:
 *     tags: [Shared groups]
 *     summary: Delete an expense of a shared group (soft delete)
 *     description: >
 *       Idempotent — deleting an already-deleted expense answers it unchanged.
 *       The row stays, marked, because a group has to keep reading as what
 *       happened.
 *
 *       When the expense was a movement of yours, **the movement is not
 *       deleted**: it leaves the group, the whole of it counts as yours again
 *       and its history says so. Deleting the movement instead is what takes
 *       both away.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared expense ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     responses:
 *       200:
 *         description: The deleted expense (also when it was already deleted)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedExpense'
 *       400:
 *         description: Invalid ID format (code VALIDATION)
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
 *       404:
 *         description: Shared expense not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The resource changed since the `If-Match` version (code STALE_UPDATE)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SharedExpenseConflict'
 */
router.delete(
  "/:id/expenses/:expenseId",
  validate(sharedExpenseParamsSchema),
  SharedExpenseController.deleteExpense,
);

export default router;
