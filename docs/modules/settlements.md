# Settlements Module

## What This Module Does

Records **the money that changes hands between you and the people you split expenses with**: what came back to you, what you handed over, and what each of those covered. One endpoint family, `/settlements`, and one collection.

It is the answer to the owner's rule, and everything here follows from it:

> **What counts as yours is the money that left your accounts minus the money that came back.**

So a payment is never a figure somebody types onto a line. It is money, and where it lands is **derived**: a payment belongs to the person, not to the expense, and it covers **the oldest line first** across every group you share with them. Change anything — delete a line, edit a split, add somebody to a group — and it is imputed again over what is left, with nothing undone.

## Files and Responsibilities

| File                                                 | Role                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/app/routes/sharedSettlementRoutes.ts`           | The four routes, with their OpenAPI blocks                                |
| `src/app/controllers/SharedSettlementController.ts`  | Thin HTTP handler                                                         |
| `src/app/services/SharedSettlementService.ts`        | One settle-up: what it covers, and the movements it writes                |
| `src/app/services/SharedLedgerService.ts`            | **The imputation**, and what it leaves on every movement                  |
| `src/shared/sharedImputation.ts`                     | `impute()` — oldest line first, in one place for the server and the phone |
| `src/domain/entities/SharedSettlement.ts`            | The entity                                                                |
| `src/infrastructure/models/SharedSettlementModel.ts` | Document and indexes                                                      |

## One payment, two halves

A settle-up is **one record** with a counterparty, a date, and two figures:

- **`collected`** — what came back to you.
- **`paid`** — what you handed over.

Both can be on the same payment, which is what happens when the two of you owe each other: Ana owes you $60,000 for the dinner, you owe her $30,000 for the tickets, she sends $30,000. What is **recorded** is the collection of $60,000 **and** your expense of $30,000; what **moves** is the net. Splitting it in two is what keeps the categories exact — a single net movement would leave your share of the tickets counted nowhere.

The counterparty is a **contact** or the **block of guests of one expense** (`expenseId`). A block has no other expense to net against, no email and no history across groups; everything else about it works the same, write-offs included.

## What each half writes in your ledger

| Half                            | In the shared layer                                                        | In your ledger                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `collected`                     | Covers what they owe you, oldest line first                                | **One `SETTLEMENT` movement** into `accountId`. Not income: no category, out of Stats and of the budgets — the shape `ADJUSTMENT` already has |
| `paid`, over lines they fronted | Covers what you owe them, oldest line first                                | **One ordinary `EXPENSE` per line**, with that line's description, **dated that line**, in the category you give                              |
| `paid`, beyond that             | **Gives back** what they paid ahead, and comes off what they had given you | **One `SETTLEMENT` movement** out of `accountId`. You never spent it, so it carries no category either                                        |

**Paying somebody back is not one movement.** The shared layer carries no categories — they are private and never travel — so the request states one in `categoryId`, or one per line in `categories`. An expense per line is more rows and the right figures: it lands in the month the money was spent, under the category it belongs to.

**`outsideApp` is cash the app never saw.** (Applying it to the paying-back direction too — no movement, therefore no expense of yours — is a decision this module took, not one the design states: money that never went through an account the app keeps is money it cannot count. It is the owner's to overturn.) Nothing is written in an account and no balance moves, and what is owed falls all the same, because that money did change hands. It is the only place where what counts as yours moves without an account moving. The same applies to the other direction: paying somebody back in cash the app never held records the payment and creates no expense, because that spending never went through a tracked account.

**A refund undoes a collection, it does not sit beside it.** What you hand over covers the lines you owe first; whatever is left of it is their money going back, and it comes off what they have given you **before any of it is imputed**. Without that, giving somebody their surplus back would leave the collection still sitting in the pool and silently pre-paying the next line they appear on.

**You cannot hand over more than you owe** plus whatever they have paid ahead: `400 SETTLEMENT_OVER_PAID`. A collection is not capped the same way, and that asymmetry is deliberate: the design says somebody can be "$160,000 ahead", so paying more than your share is a real thing, and what it leaves is a surplus that is theirs to get back. Money leaving for nothing is not.

Two limits worth knowing. The guard is checked inside the write's own database transaction, but two refunds **to different accounts** at the same moment write no document in common, so nothing makes them conflict and both can pass: the worst case is a refund beyond the surplus, by a user racing themselves on two devices. And a **replay** — the same client-minted `id` sent twice — answers the payment with an empty `covered`, because what it covered was worked out when it was first recorded.

## What a payment leaves behind

`collected` on each share of an expense is **the imputation, never a typed figure**: every write that touches a split or a payment computes it again from the live payments. What that leaves on the movement you fronted is `amount − what came back`, written on it as `countsAsYours` with a line of history — see [transactions.md](transactions.md#what-counts-as-yours-countsasyours). **It falls in the month the expense happened**, not on the day of the payment, so a month you had already closed can change; the history is what explains it.

Recording a payment and undoing one both answer **`restamped`** as well: the lines whose `collected` moved and the movements whose figure or history moved with them, each with its `updatedAt` before and after (T-145; `docs/modules/sync.md`, _Rows a write rewrote besides its own_). Deleting a payment reverses **every movement it recorded** and imputes what is left over the lines that are still open. The same happens to whoever else is involved whenever a line changes: a new amount, a new **date** (which is what orders the imputation), a split saved, people added to the group, or the line deleted.

**A block of guests cannot be left behind.** It lives in one expense, so if it has paid, that expense does not go until those payments are undone: `400 GUEST_BLOCK_HAS_PAYMENTS` on both doors. A person has other lines to re-impute onto and a name to give the money back to; a block has neither. The movements themselves cannot be edited or deleted on their own (`400 SETTLEMENT_MOVEMENT_LOCKED`): their money belongs to the payment, and the payment is the door.

## Public API

| Route                      | What it does                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /settlements`         | Newest first, keyset over `(date, _id)`; `contactId` or `expenseId` narrows it to one counterparty |
| `POST /settlements`        | One settle-up. Answers the payment **and what it covered**, line by line, plus what was refunded   |
| `GET /settlements/{id}`    | One payment                                                                                        |
| `DELETE /settlements/{id}` | Undoes it, movements included. Idempotent                                                          |

## Storage

| Collection         | Index                                             | Why                                                                        |
| ------------------ | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `SharedSettlement` | `{ userId, "counterparty.contactId", deletedAt }` | Everything settled with one person, which is what an imputation reads      |
| `SharedSettlement` | `{ userId, "counterparty.expenseId", deletedAt }` | The same for a block of guests                                             |
| `SharedSettlement` | `{ userId, deletedAt, date, _id }`                | The listing and its keyset                                                 |
| `SharedSettlement` | `{ userId, updatedAt, _id }`                      | The keyset the offline change feed scans                                   |
| `Transaction`      | `{ userId, sharedSettlementId }`, partial         | The movements one settle-up recorded, so undoing it reverses exactly those |

Money is integer cents here too. **The payment carries no account and no category**: those are yours, and a shared group is seen by everybody in it. What travels is that it was paid.

**An imputation is bounded by one counterparty, not by one group.** It reads every live expense where they hold a share — one indexed query, across every group — and every payment with them, and rewrites only the shares that moved. So it never has to look at anybody else's lines, but it **is** linear in how much history you have with that person, and it runs once per counterparty of the line being written: recording an expense in a group of ten people is ten of those reads. That is the ceiling this design has; the alternative, a stored running total per person, is a figure to keep in step, which is the thing this feature refuses to do anywhere else.

## What This Module Does Not Do

- **It does not write `countsAsYours` by itself.** `SharedLedgerService` does, and it is the only thing that does.
- **It does not write off anything.** Giving up on what somebody owes is a decision about a group, and it lives there ([shared-groups.md](shared-groups.md)); it moves no figure either way.
- **It does not decide what travels.** Payments ride the change feed with their tombstone, and come back from the outbox as `settlement:create` and `settlement:delete` ([sync.md](sync.md)).
