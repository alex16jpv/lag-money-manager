# Joined Groups Module

## What This Module Does

Shows a shared group to **somebody who joined it**, and lets them take their part of a paid line into their own ledger. It is the other side of [invitations.md](invitations.md): that module decides who is in, and this one decides what they read and the one thing they can write.

Everything here follows from the frontier the shared layer was built around ([sync.md](sync.md)): **the group travels, and nobody's ledger travels with it**. What somebody who joined reads is the group, its people, its lines, who paid each one, how each is split and where everybody stands. They never see the owner's accounts, categories or notes, what counts as the owner's, or which movement a line is. None of that is in the shared layer, so there is nothing to strip out.

Four decisions, all the owner's (2026-09-22):

- **Only the owner writes in a group** (v1). Everything here reads, except `Add to my ledger`, which writes in the reader's own ledger and nothing in the group. The owner has said this changes soon: nothing in the shape below assumes it never will.
- **`Add to my ledger` only on a line the owner has marked paid** for that person. She recorded the money arriving in her account, and this records it leaving theirs: the two sides of one payment. So nothing lands before the money moved, and nothing lands twice.
- **A group the owner archives stays** with whoever joined, read-only. Archiving withdraws only the invitations still waiting.
- **Names.** The owner and anybody who joined go by the name on **their own profile**. Anybody who has not joined goes by the name the owner gave them, which is the only name the group has for them.

## Files and Responsibilities

| File                                           | Role                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `src/app/routes/joinedGroupRoutes.ts`          | The four routes, at `/joined-groups`                                    |
| `src/app/controllers/JoinedGroupController.ts` | Thin HTTP handler                                                       |
| `src/app/services/JoinedGroupService.ts`       | Who is in, what they read, the feed's two sources, and Add to my ledger |
| `src/domain/entities/JoinedGroup.ts`           | The two views: `JoinedGroupView` and `JoinedExpenseView`                |

It owns no collection. It reads invitations, groups, lines, contacts and profiles, and writes one transaction.

## Who is in

**A live `ACCEPTED` invitation whose `inviteeId` is you**, and nothing else. It is not the contact: a contact is the owner's address book and is never linked to a user ([contacts.md](contacts.md)). Anything that ends the invitation ends the reading, including the owner stopping sharing, taking you out of the group, archiving your contact or deleting their account, and you leaving. A group you are not in answers `404`, the same as one that does not exist.

## What it reads

**The group** (`JoinedGroup`):

- `name`, `color`, `currency` and `archivedAt`.
- `ownerName`.
- `defaultSplit` and `writeOffs`, as the owner keeps them.
- One row per participant: `contactId`, `name`, `color`, `you` and `joined`.
- `invitationId`, the invitation you joined with, which is what leaving goes through.

**`contactId: null` is the owner**, exactly as in the owner's own rows, so a line's `paidByContactId: null` and its `USER` share are hers.

**A line** (`JoinedExpense`) is the owner's expense minus who owns it. Your part is the `CONTACT` share your participant row names, and it reads paid once its `collected` reaches its `amount`. `collected` is the owner's imputation ([settlements.md](settlements.md)), so the states you see are hers: **the only debt the group keeps is what each person owes the one who shared it**. A line another participant paid is between the two of you.

## How it reaches the devices

Through the change feed ([sync.md](sync.md)), two sources, `joinedGroups` and `joinedExpenses`. There is no batch operation for anything here.

**A row's position in the feed is when it last changed or when you joined, whichever is later.** That is what makes joining work. A group joined after your cursor has rows older than the cursor, and a plain `updatedAt > cursor` would never send them. Placed at the moment of joining, they arrive whole and page like any other rows. After that, only what changes arrives. The view's `updatedAt` carries that position.

**The group row moves when the names on it change through the group**, not only when the group does. Its position is the latest of the group, the moment you joined, every invitation of the group, and the contact behind each participant. So somebody else joining or leaving, or a rename in the owner's address book, sends the group again. **A rename on somebody's own profile does not**, because a profile's `updatedAt` also moves on every sign-in, and following it would resend every group to everybody in it each time anybody logs in. The new name arrives with the group's next change, and the listing always has it.

**What it costs per page:** one read of your memberships. When you have none, which is most users, that is all. Otherwise it adds four batched reads for the views (groups, their invitations, contacts, profiles) and one keyset scan over every joined group's lines (`{ groupId, updatedAt, _id }`), which for a group joined after the cursor only looks past the moment you joined. On top of that, for each group joined after the cursor, one read of what it held when you joined, **in id order and never more than a page** (`{ groupId, _id }`): a page that stops inside it resumes at the id it stopped on. Every read is bounded by the page, however big the group or the rest of your data.

A membership that ends is learned from the invitation, which keeps reaching the invited person with its new status (`invitationsReceived`). The device drops the group and its lines then.

## Public API

### `GET /joined-groups`, `GET /joined-groups/{id}`, `GET /joined-groups/{id}/expenses`

The fallback for a device with no copy of the feed yet. The listing pages over your memberships (the cursor is the `invitationId`), and the lines over `(date, _id)`, newest first, exactly as the owner's list does.

### `POST /joined-groups/{id}/expenses/{expenseId}/add-to-ledger`

`{ id?, accountId, categoryId? }`. It writes **one ordinary expense of yours**: your share, dated the line, with its description, from `accountId` and in `categoryId`. It writes nothing in the group, and nothing the owner can see.

Refused with `400 SHARED_LINE_NOT_PAID` for a line somebody other than the owner paid, one you have no part in, and one whose part is not marked paid yet, `Written off` included. A line already in your ledger is `400 SHARED_LINE_IN_LEDGER`. The account and the category follow the rules of any expense, because it goes through `TransactionService.recordAnswered`, and like any movement it answers `restamped` with the account whose balance it moved (T-146; [sync.md](sync.md)).

**Once per line.** The movement carries `importedFromGroupId` and `importedFromExpenseId`, and a partial unique index over `{ userId, importedFromExpenseId }` on the live ones makes that a guarantee rather than a check. Two devices adding the same line at once meet in the index, and the loser answers `SHARED_LINE_IN_LEDGER`. Deleting the movement frees the line. A client-minted `id` replays like any create.

**Your ledger is yours.** Nothing the owner does later reaches that movement: if she undoes the payment or changes the line, the movement stays as it is, and the screen says what no longer matches. It cannot be put into a group of your own (`TRANSACTION_NOT_SPLITTABLE`), because it already is your part of one, and it stays an expense. See [transactions.md](transactions.md).

Needs a connection: whether the line is still paid and still shared with you is the server's to say.

## What This Module Does Not Do

- **It does not let anybody but the owner write in a group.**
- **It keeps no debt between two participants.** What Beto owes Marta for a line she paid is theirs to settle, in v1.
- **It does not link a contact to a user.** Who joined is the invitation.
