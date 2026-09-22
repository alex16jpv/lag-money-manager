# Invitations Module

## What This Module Does

Lets somebody see one of your shared groups. An invitation is **addressed to the email of a contact who is in the group**, waits in that person's Shared, and is accepted or declined there. It is the first thing in this API that one user writes for another to read, so most of what follows is about what each side may learn.

**Nothing is emailed.** There is no mail system: the address is how the invited person is recognised, and they find the invitation the next time they open the app with that address. What joining lets them see of the group, and putting their part into their own ledger, is the next task (T-130); this module only decides who is in.

Four rules, three of them the owner's (2026-09-22):

- **Each group is its own invitation.** Somebody who joined one of your groups is asked again for the next one, and never lands in a group they did not accept.
- **It waits 30 days** (`INVITATION_LIFETIME_DAYS`). Nothing wakes the server at that moment, so an invitation past its `expiresAt` is **not marked**: it stays `PENDING` and is judged by its date — the client stops showing it, and the server refuses to answer it.
- **A group in another currency cannot be joined.** Each user keeps one currency, so the invited person can only decline, and the inviter is never told why.
- **The inviter never learns whether an address has an account.** Inviting does not look the address up at all: the answer, its shape and its timing are the same either way, and the row reads `PENDING` until the other person answers. Joining and declining are the invited person's own acts, and those the inviter does see.

**A known risk the owner accepted:** email addresses are not verified in this API, so whoever registers with somebody else's address receives what is sent to it. What an invitation shows before joining is only the group's name and who sent it, and the inviter sees `ACCEPTED` and can stop sharing at any time. It closes the day addresses are verified.

## Files and Responsibilities

| File                                                 | Role                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/app/routes/sharedGroupRoutes.ts`                | The inviter's three routes, under the group                                      |
| `src/app/routes/invitationRoutes.ts`                 | The invited person's three routes, at `/invitations`                             |
| `src/app/controllers/SharedInvitationController.ts`  | Thin HTTP handler                                                                |
| `src/app/services/SharedInvitationService.ts`        | Inviting, withdrawing, answering, and who may see which                          |
| `src/domain/entities/SharedInvitation.ts`            | The entity, and the two views: `SentInvitationView` and `ReceivedInvitationView` |
| `src/infrastructure/models/SharedInvitationModel.ts` | Document and indexes                                                             |
| `src/infrastructure/repositories/sharedInvitation/`  | Mongoose implementation, and the invited person's side of the change feed        |

## Two views of one row

The same document reads differently to each side, and the difference **is** the privacy rule:

| Field                                                | The inviter (`SentInvitation`) | The invited person (`ReceivedInvitation`) |
| ---------------------------------------------------- | ------------------------------ | ----------------------------------------- |
| `id`, `groupId`, `status`, `expiresAt`, `answeredAt` | ✓                              | ✓                                         |
| `contactId`, `email`                                 | ✓ — their own address book     | —                                         |
| `withdrawnAt`                                        | ✓                              | —                                         |
| `groupName`, `groupColor`, `groupCurrency`           | — (they have the group)        | ✓                                         |
| `inviterName`, `inviterEmail`                        | —                              | ✓ — so the person can tell who it is      |
| who answered (`inviteeId`)                           | **never**                      | —                                         |

`groupName` and `groupColor` are a snapshot the server keeps current **while the invitation waits**: renaming or recolouring the group rewrites them in the same transaction, so the waiting person sees the group as it is. `inviterName` and `inviterEmail` are the sender's profile when it was sent.

## Status

| `status`    | Meaning                                                  | `open`                                                                                     |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `PENDING`   | Waiting. Answerable only while `expiresAt` is ahead      | `true` until it is answered, withdrawn, or an expired one steps aside for a new invitation |
| `ACCEPTED`  | They joined                                              | `true` until sharing stops                                                                 |
| `DECLINED`  | They said no                                             | absent                                                                                     |
| `WITHDRAWN` | It ended without an answer, or sharing stopped after one | absent                                                                                     |

`open` is present — and only ever `true` — on the one **live** invitation of a person in a group, and a partial unique index on `{groupId, contactId}` holds that there is at most one. Two invites that arrive at once meet in the index, not in a read: the loser's upsert hits the duplicate key — MongoDB only retries that by itself when the filter is exactly the index key, and `open` is one field more — and `openOne` answers it with the row that won, as `200`.

Deleting an account withdraws the invitations it left waiting, so they leave strangers' Shared on their next pull.

What ends a live invitation, and what each one ends:

| Event                                                   | Waiting | Joined                                                       | Where                                                    |
| ------------------------------------------------------- | ------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `DELETE /shared-groups/{id}/invitations/{invitationId}` | ✓       | ✓ (stop sharing)                                             | This module                                              |
| The group is archived                                   | ✓       | — (T-130 decides what an archived group shows to who joined) | `SharedGroupService.deleteGroup`, same transaction       |
| The person is taken out of the group                    | ✓       | ✓                                                            | `SharedGroupService.removeParticipant`, same transaction |
| Their contact is archived                               | ✓       | ✓                                                            | `ContactService.deleteContact`, same transaction         |
| Their contact's email changes, or is cleared            | ✓       | —                                                            | `ContactService.updateContact`, same transaction         |

Restoring a group or a contact brings none of them back: inviting again is how somebody comes back.

## Public API

### `POST /shared-groups/{id}/invitations`

`{ contactId }`. The contact has to be an active contact of yours **in the group**, with an email (`400 CONTACT_HAS_NO_EMAIL`) that is not your own (`400 INVITATION_TO_SELF`); the group has to be open (`400 RESOURCE_ARCHIVED`).

**Idempotent by the index**: when that person already has a live invitation — waiting and in time, or joined — it is answered as it is with `200`. One that is waiting but out of time steps aside and a new one is written (`201`), with a new id, so the device that showed the old one never mistakes the two.

A user may have at most **50 invitations waiting and in time** — a count read before the write, so a burst of parallel invites can pass it by the width of the burst; it bounds abuse, it is not a ledger (`MAX_PENDING_INVITATIONS_PER_USER`, `400 INVITATION_LIMIT_REACHED`, published as `SharedLimits.maxPendingInvitationsPerUser`). It is what bounds how much one person can put into strangers' Shared. Answering the live invitation of somebody already invited is never refused by it.

### `GET /shared-groups/{id}/invitations`

Every invitation of the group, oldest first, in the inviter's view, paginated (offset + keyset over `_id`).

### `DELETE /shared-groups/{id}/invitations/{invitationId}`

Withdraws a waiting invitation, or stops sharing with somebody who joined. **Nothing about the money moves**: the person stays in the group as somebody you split with. Idempotent, and an invitation of another group of yours is a `404`, like one of another user's.

### `GET /invitations`

The invitations waiting for **the email on your profile** and still in time, oldest first, in the invited person's view. The offline client reads them from the change feed instead, which also brings the ones already answered; this listing is its fallback.

### `POST /invitations/{id}/accept`, `POST /invitations/{id}/decline`

The invitation has to be addressed to your email, or already answered by you — anything else is a `404`, the same as one that does not exist. Answering your own is `400 INVITATION_TO_SELF`.

- **Accept** refuses a group in another currency (`400 CURRENCY_MISMATCH`), a group you already joined through another contact of the same inviter (`400 PARTICIPANT_ALREADY_IN_GROUP`), and one that can no longer be answered (`400 INVITATION_UNAVAILABLE`). It moves the invitation to `ACCEPTED` and fills the inviter's contact's `linkedUserId` **in one transaction**; the group is read inside it, so a group archived or a person taken out a moment before answers `INVITATION_UNAVAILABLE` instead of joining.
- **Decline** takes any currency.

Both are idempotent for the person who already gave that answer; the other answer after it is `INVITATION_UNAVAILABLE`, and so is one whose sender deleted their account. Nothing in either person's data is written besides the invitation: not the invited person's ledger, and **not the inviter's contact** — its `linkedUserId` stays `null`, because it would tell the inviter who answered and bump a row they may be editing offline ([contacts.md](contacts.md)).

**An address is not a person.** An invitation reaches the invited person by their email only while **nobody has answered it**; once answered, it belongs to whoever did, by `inviteeId`. So a user who changes their email keeps their answers, and whoever registers the old address later sees only what still waits there — never somebody else's history of groups joined or declined. `accept`, `decline` and the change feed apply the same rule.

## How it reaches the devices

Through the change feed ([sync.md](sync.md)), two sources:

- `invitationsSent` — the inviter's rows, over `(userId, updatedAt, _id)`.
- `invitationsReceived` — the invited person's, found **by the email on their profile** over `(email, updatedAt, _id)` among the rows nobody has answered, and **by who answered** over `(inviteeId, updatedAt, _id)`. The second keeps an answered invitation reaching them after they change their email. The two scans are merged by id.

Every event above rewrites the row, so its `updatedAt` moves and both sides learn it on their next pull. There is **no batch operation**: inviting, withdrawing and answering all need a connection, because each is about somebody else and only the server can say whether the invitation still stands.

## Storage

| Index                                                            | Why                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ groupId, contactId }` unique, partial on `open: true`         | One live invitation per person per group                                                                                                                                                                          |
| `{ userId, groupId, _id }`                                       | The group's listing and its keyset                                                                                                                                                                                |
| `{ userId, contactId }`                                          | What a contact's archive or new email ends                                                                                                                                                                        |
| `{ userId, status, expiresAt }`                                  | How many of yours are waiting, for the cap                                                                                                                                                                        |
| `{ email, status, expiresAt, _id }`                              | What waits for an address, and its keyset                                                                                                                                                                         |
| `{ userId, updatedAt, _id }`                                     | The inviter's side of the change feed                                                                                                                                                                             |
| `{ email, updatedAt, _id }`                                      | The invited person's side, by address                                                                                                                                                                             |
| `{ inviteeId, updatedAt, _id }`, partial on `inviteeId` existing | The invited person's side, once answered. `inviteeId` is **absent**, not null, until then: the planner only uses a partial index whose filter the query implies, and an equality implies `$exists`, never `$type` |

## What This Module Does Not Do

- **It does not show the group.** What somebody who joined can read of it, and `Add to my ledger`, are T-130.
- **It sends nothing.** When notifications exist, the route that creates an invitation adds its `notify()` call in the same transaction ([notifications.md](notifications.md)); nothing else here changes.
- **It never tells the inviter who answered**, nor whether an address has an account.
