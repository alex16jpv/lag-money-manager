import { Router } from "express";

import { ContactController } from "../controllers/ContactController";
import {
  createContactSchema,
  idParamSchema,
  paginationQuerySchema,
  restoreSchema,
  updateContactSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /contacts:
 *   get:
 *     tags: [Contacts]
 *     summary: Get all contacts
 *     description: >
 *       The people you split expenses with. Archived contacts are hidden
 *       unless includeArchived=true. A contact is not an account: it has no
 *       balance, never appears among the accounts, and no money ever moves in
 *       it.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Maximum number of items to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of items to skip (offset-based pagination)
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the last item of the previous page; must name a row of the caller's (cursor-based pagination; overrides offset)
 *       - in: query
 *         name: ids
 *         schema:
 *           type: string
 *         description: Comma-separated list of contact UUIDs to filter by ID (1-100)
 *       - in: query
 *         name: includeArchived
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Include archived contacts in the listing
 *     responses:
 *       200:
 *         description: Paginated list of contacts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContactList'
 *       400:
 *         description: Invalid query parameters (code VALIDATION), or a cursor that names no contact of the caller's (code INVALID_CURSOR)
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
  validate(paginationQuerySchema),
  ContactController.getAllContacts,
);

/**
 * @openapi
 * /contacts:
 *   post:
 *     tags: [Contacts]
 *     summary: Create a contact
 *     description: >
 *       Requires `name`. Active contact names are unique per user,
 *       case-insensitively ("Ana" = "ana"; accents still distinct) and
 *       trimmed; archiving a contact frees its name.
 *
 *       `email` is optional and is only an **identifier for inviting them
 *       later**: nothing is sent from here, and two contacts may carry the
 *       same address. A contact is never linked to a user: who joined a group
 *       is the accepted invitation, which never tells the inviter who answered.
 *
 *       A user is capped at `SharedLimits.maxContactsPerUser` active contacts
 *       (400 CONTACT_LIMIT_REACHED). Read that schema instead of copying the
 *       number: the sheet that adds a contact is meant to say the limit before
 *       a save can fail on it.
 *
 *       Accepts an optional client-minted `id` (UUID). An id the user already
 *       owns replays with 200 and the stored resource, whatever the payload
 *       says now; an id that belongs to another user is rejected with 409
 *       ID_TAKEN.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateContactInput'
 *     responses:
 *       200:
 *         description: Replay of a create already made with this client-minted id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contact'
 *       201:
 *         description: Contact created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contact'
 *       400:
 *         description: Validation error (code VALIDATION) or contact limit reached (code CONTACT_LIMIT_REACHED)
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
 *       409:
 *         description: An active contact with this name already exists (code DUPLICATE, case-insensitive), or the client-minted id is already in use (code ID_TAKEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/",
  validate(createContactSchema),
  ContactController.createContact,
);

/**
 * @openapi
 * /contacts/{id}:
 *   get:
 *     tags: [Contacts]
 *     summary: Get a contact by ID
 *     description: >
 *       Also resolves archived contacts (archivedAt tells them apart); only
 *       the listing hides them by default.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *     responses:
 *       200:
 *         description: Contact found (may be archived)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contact'
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
 *         description: Contact not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id", validate(idParamSchema), ContactController.getContactById);

/**
 * @openapi
 * /contacts/{id}:
 *   put:
 *     tags: [Contacts]
 *     summary: Update a contact
 *     description: Partial update. `color` and `email` accept null to clear them.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateContactInput'
 *     responses:
 *       200:
 *         description: Contact updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contact'
 *       400:
 *         description: Validation error (code VALIDATION) or contact is archived (code RESOURCE_ARCHIVED, restore it first)
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
 *         description: Contact not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Another active contact already uses this name (code DUPLICATE, case-insensitive), or the resource changed since the `If-Match` version (code STALE_UPDATE; `current` carries the server's copy)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContactConflict'
 */
router.put(
  "/:id",
  validate(updateContactSchema),
  ContactController.updateContact,
);

/**
 * @openapi
 * /contacts/{id}:
 *   delete:
 *     tags: [Contacts]
 *     summary: Archive a contact (soft delete)
 *     description: >
 *       A contact is archived, never deleted: the groups and the payments that
 *       name it stay readable. Idempotent — archiving an already-archived
 *       contact is a no-op success.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Contact ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     responses:
 *       200:
 *         description: The archived contact (also when it was already archived), with its new `updatedAt`
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contact'
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
 *         description: Contact not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The resource changed since the `If-Match` version (code STALE_UPDATE; `current` carries the server's copy)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContactConflict'
 */
router.delete("/:id", validate(idParamSchema), ContactController.deleteContact);

/**
 * @openapi
 * /contacts/{id}/restore:
 *   post:
 *     tags: [Contacts]
 *     summary: Restore an archived contact, optionally under a new name
 *     description: Idempotent — restoring an already-active contact returns it unchanged.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Contact ID
 *       - $ref: '#/components/parameters/IfMatch'
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RestoreInput'
 *     responses:
 *       200:
 *         description: Contact restored (or already active)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contact'
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
 *         description: Contact not found (uniform for missing and not owned)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: An active contact took this name while it was archived (code DUPLICATE) — rename that one first, or the resource changed since the `If-Match` version (code STALE_UPDATE; `current` carries the server's copy)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContactConflict'
 */
router.post(
  "/:id/restore",
  validate(restoreSchema),
  ContactController.restoreContact,
);

export default router;
