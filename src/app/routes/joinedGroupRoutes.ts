import { Router } from "express";

import { JoinedGroupController } from "../controllers/JoinedGroupController";
import {
  addToLedgerSchema,
  getJoinedGroupsSchema,
  getSharedExpensesSchema,
  idParamSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /joined-groups:
 *   get:
 *     tags: [Joined groups]
 *     summary: The groups somebody else shared with you
 *     description: >
 *       The groups whose invitation you accepted and that are still shared with
 *       you, archived ones included, read-only. Nothing of anybody's ledger
 *       travels: no account, category or note. The offline client reads them
 *       from the change feed (`joinedGroups`); this listing is its fallback.
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
 *         description: ID of the invitation last read (the group's `invitationId`); overrides offset
 *     responses:
 *       200:
 *         description: Paginated list of the groups shared with you
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/JoinedGroupList'
 *       400:
 *         description: Invalid query parameters (code VALIDATION), or a cursor that names none of your groups (code INVALID_CURSOR)
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
router.get("/", validate(getJoinedGroupsSchema), JoinedGroupController.list);

/**
 * @openapi
 * /joined-groups/{id}:
 *   get:
 *     tags: [Joined groups]
 *     summary: One group shared with you
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Shared group ID
 *     responses:
 *       200:
 *         description: The group
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/JoinedGroup'
 *       400:
 *         description: Validation error (code VALIDATION)
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
 *         description: Not a group shared with you (uniform for missing, not joined and no longer shared)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id", validate(idParamSchema), JoinedGroupController.get);

/**
 * @openapi
 * /joined-groups/{id}/expenses:
 *   get:
 *     tags: [Joined groups]
 *     summary: The lines of a group shared with you
 *     description: >
 *       Newest expense first, keyset over (date, id), exactly as the owner
 *       keeps them. Your part of each is the CONTACT share your participant
 *       row names.
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
 *         description: ID of the last expense of the previous page (overrides offset)
 *     responses:
 *       200:
 *         description: Paginated list of the group's lines
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/JoinedExpenseList'
 *       400:
 *         description: Invalid parameters (code VALIDATION), or a cursor that names no line of this group (code INVALID_CURSOR)
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
 *         description: Not a group shared with you
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:id/expenses",
  validate(getSharedExpensesSchema),
  JoinedGroupController.listExpenses,
);

/**
 * @openapi
 * /joined-groups/{id}/expenses/{expenseId}/add-to-ledger:
 *   post:
 *     tags: [Joined groups]
 *     summary: Add your part of a paid line to your own ledger
 *     description: >
 *       Offered only on a line the person who shared the group paid, and only
 *       once they have marked your part of it paid: they recorded the money
 *       arriving in their account, and this records it leaving yours. It
 *       writes one ordinary expense of yours — your share, dated the line,
 *       with its description, from `accountId` and in `categoryId` — and
 *       nothing in the group. One line reaches your ledger once; deleting that
 *       expense makes it ready again. Needs a connection: there is no batch
 *       operation for it.
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
 *         description: The line
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddToLedgerInput'
 *     responses:
 *       201:
 *         description: Your expense
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransactionWithRestamps'
 *       200:
 *         description: The expense already created under that client-minted id (replay)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransactionWithRestamps'
 *       400:
 *         description: Validation error (code VALIDATION), a line somebody else paid, one you have no part in or whose part is not marked paid (code SHARED_LINE_NOT_PAID), a line already in your ledger (code SHARED_LINE_IN_LEDGER), or an archived category (code CATEGORY_ARCHIVED)
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
 *         description: Not a group shared with you, a line not in it, or an account or category not yours
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: The client-minted id belongs to somebody else (code ID_TAKEN)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/expenses/:expenseId/add-to-ledger",
  validate(addToLedgerSchema),
  JoinedGroupController.addToLedger,
);

export default router;
