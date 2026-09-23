import { Router } from "express";

import { SharedInvitationController } from "../controllers/SharedInvitationController";
import {
  getReceivedInvitationsSchema,
  idParamSchema,
} from "../validation/schemas";
import { validate } from "../validation/validate";

const router = Router();

/**
 * @openapi
 * /invitations:
 *   get:
 *     tags: [Invitations]
 *     summary: The invitations waiting for you
 *     description: >
 *       Invitations to somebody else's shared group, addressed to your email,
 *       still waiting and still in time, oldest first. Each one shows only the
 *       group's name, its colour and currency, and who sent it. The offline
 *       client reads them from the change feed (`invitationsReceived`), which
 *       also brings the ones already answered; this listing is its fallback.
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
 *         description: ID of the last item of the previous page; must name an invitation of this listing (overrides offset)
 *     responses:
 *       200:
 *         description: Paginated list of the invitations waiting for you
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReceivedInvitationList'
 *       400:
 *         description: Invalid query parameters (code VALIDATION), or a cursor that names no invitation of this listing (code INVALID_CURSOR)
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
  validate(getReceivedInvitationsSchema),
  SharedInvitationController.listReceived,
);

/**
 * @openapi
 * /invitations/{id}/accept:
 *   post:
 *     tags: [Invitations]
 *     summary: Join the shared group you were invited to
 *     description: >
 *       Joining touches nothing in your ledger. A group in another currency
 *       cannot be joined (only declined), and an invitation that was withdrawn,
 *       whose group was archived, or whose 30 days passed answers
 *       INVITATION_UNAVAILABLE. Accepting twice answers the invitation as it
 *       is.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Invitation ID
 *     responses:
 *       200:
 *         description: The invitation, accepted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReceivedInvitation'
 *       400:
 *         description: Validation error (code VALIDATION), an invitation that can no longer be answered (code INVITATION_UNAVAILABLE), a group in another currency (code CURRENCY_MISMATCH), your own invitation (code INVITATION_TO_SELF), or a group you already joined through another invitation (code PARTICIPANT_ALREADY_IN_GROUP)
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
 *         description: Invitation not found (uniform for missing and addressed to somebody else)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/accept",
  validate(idParamSchema),
  SharedInvitationController.accept,
);

/**
 * @openapi
 * /invitations/{id}/decline:
 *   post:
 *     tags: [Invitations]
 *     summary: Decline an invitation to a shared group
 *     description: >
 *       The person who invited learns it was declined, never why. Declining
 *       twice answers the invitation as it is.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Invitation ID
 *     responses:
 *       200:
 *         description: The invitation, declined
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReceivedInvitation'
 *       400:
 *         description: Validation error (code VALIDATION), an invitation that can no longer be answered (code INVITATION_UNAVAILABLE), or your own invitation (code INVITATION_TO_SELF)
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
 *         description: Invitation not found (uniform for missing and addressed to somebody else)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/decline",
  validate(idParamSchema),
  SharedInvitationController.decline,
);

/**
 * @openapi
 * /invitations/{id}/leave:
 *   post:
 *     tags: [Invitations]
 *     summary: Leave a shared group you joined
 *     description: >
 *       Stop seeing the group, from your side. You stay in it as somebody the
 *       owner splits with: your share, what you paid and what you owe do not
 *       move, and nothing in your ledger is touched. The owner's row reads
 *       LEFT. Leaving twice answers the invitation as it is; one that is no
 *       longer joined (the owner stopped sharing) answers
 *       INVITATION_UNAVAILABLE.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Invitation ID
 *     responses:
 *       200:
 *         description: The invitation, left
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReceivedInvitation'
 *       400:
 *         description: Validation error (code VALIDATION), or an invitation that is no longer joined (code INVITATION_UNAVAILABLE)
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
 *         description: Invitation not found (uniform for missing and not yours)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/:id/leave",
  validate(idParamSchema),
  SharedInvitationController.leave,
);

export default router;
