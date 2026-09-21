# Shared Groups Module

## What This Module Does

Holds **shared groups** — an outing, a dinner, a two-month trip — with the people in them, the expenses they cost and how each expense is split. It is the shared layer of the expense-splitting feature: the fact of what was spent, who fronted it and whose part it is.

**It contains no money of the user's.** No account, no category, no budget, no balance is touched from here. A shared expense is not a movement: it is the fact a movement is the private consequence of. An expense **can name one**, and then the movement is where the link, what counts as yours and its history are stored — never here, because a shared group is seen by everybody in it and which movement of yours it is nobody else's. What that link means on the other side is in [transactions.md](transactions.md#what-counts-as-yours-countsasyours).

Three things shape the whole module:

- **A group has no period.** Cartagena trip runs from August into September and is one group. The dates belong to the expenses; the group's range, its total and your share are **derived on every read** by one aggregation, never stored. Nothing here may assume a month.
- **The group's split is a default, not a rule.** A new expense inherits it without asking; any expense can carry its own in any of the four modes. Changing the default is **never retroactive**.
- **The shares always add up to the expense, and the odd minor unit goes to whoever paid.** $100,000 does not divide by three and the Colombian peso has no cents, so the remainder has to land somewhere chosen rather than somewhere accidental.

## Files and Responsibilities

| File                                                                     | Role                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `src/app/routes/sharedGroupRoutes.ts`                                    | Every route of the module, with its OpenAPI block                     |
| `src/app/controllers/SharedGroupController.ts`                           | Groups, participants, the preview                                     |
| `src/app/controllers/SharedExpenseController.ts`                         | The expenses of a group                                               |
| `src/app/services/SharedGroupService.ts`                                 | Participants, the default split, the derived totals, the re-split     |
| `src/app/services/SharedExpenseService.ts`                               | One expense: inherit or carry its own split, and resolve it           |
| `src/app/services/sharedSplitting.ts`                                    | Turning a stated split into a resolved one, and back                  |
| `src/shared/splitShares.ts`                                              | The arithmetic of a split, in one place, for the server and the phone |
| `src/domain/entities/SharedGroup.ts`, `SharedExpense.ts`                 | The two entities                                                      |
| `src/infrastructure/models/SharedGroupModel.ts`, `SharedExpenseModel.ts` | Documents and indexes                                                 |

## The split

A split states a **mode** and one **share** per party. A party is `USER` (you), `CONTACT` (somebody in the group) or `GUESTS` (the block whose head count sits in `guests`).

| Mode         | What each share carries                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `EQUAL`      | Nothing. Everyone the same, and a guest block weighs as many parts as it counts |
| `PERCENT`    | `percent`, two decimals, adding up to 100                                       |
| `EXACT`      | `fixedAmount`, adding up to the expense                                         |
| `FIXED_REST` | `fixedAmount` on the shares you pin; the rest divides between the others        |

Every share also carries the resolved `amount`, which is the only figure anything downstream reads.

**Shares need not cover every participant.** Leaving somebody out of one expense is exactly what an expense's own split is for. What they must do is name only people who are in the group, name nobody twice, and include whoever paid — the payer's share is the one that absorbs the remainder.

### How the remainder is decided, and why it matters

`resolveShares` works in whole minor units of the group's currency (none at all in COP). Each share is `floor(total × its parts ÷ all the parts)` — **its parts, not one floored part repeated**, which matters the moment a guest block carries twenty heads: flooring per head and multiplying would throw away a fraction twenty times and leave the block paying less than its 20/23 while the payer made up the difference. What is left over after every share is floored goes **whole to the payer's share**, and it is at most one minor unit per share. Two consequences, both deliberate:

- **The result does not depend on the order of the shares.** Each share is floored independently and one named share takes the rest, so an implementation that walks the rows differently still reaches the same figures. That is what makes the offline projection able to agree with the server to the peso, which the parity fixtures will hold it to.
- **The remainder is the payer's in every mode, a pinned payer included.** Under `FIXED_REST` that can move a pinned figure by a few pesos. The alternative — handing the odd unit to the first unpinned share — would make the result depend on the order, and an unexplainable difference between two devices is worse than a peso on the person who fronted the money.

`EXACT` never has a remainder: the shares are refused unless they already add up. The product `total × parts` is split into a quotient and a remainder before multiplying, so no intermediate passes 2^53 even at the top of `MAX_AMOUNT` in a currency with no minor unit — an implementation using 64-bit integers reaches the same figure.

### Guests

A guest block belongs to **one expense**. It is not a contact, it is not in the group, it cannot be reused and it goes when the expense goes. It weighs `count` parts and is **one party to collect from**: $230,000 between three friends and twenty guests is 23 shares of $10,000 — $30,000 between the three and $200,000 for the block. The head count sits above the rows because it governs all of them, and the block is then an ordinary money row, so the four modes work on it unchanged. The odd minor unit never goes to the block.

## Public API

Everything hangs off `/shared-groups`.

### `GET /shared-groups`

Paginated (offset + cursor, keyset over `_id`), with `ids`, `contactId` and `includeArchived` filters. Every row carries `totals`.

### `POST /shared-groups`

`name` (unique per active group, case-insensitively), optional `color`, `contactIds` for the other people — **you are always a participant and are never named there** — and an optional `defaultSplit`.

`defaultSplit.mode` is `EQUAL` or `PERCENT` only: a default has no total to divide, so `EXACT` and `FIXED_REST` are things only an expense can carry. Under `PERCENT` it needs one entry per participant (`contactId: null` is you) adding up to 100.

A group holds at most **20 people, the owner included** (`400 PARTICIPANT_LIMIT_REACHED`), published as `SharedLimits.maxParticipantsPerGroup`. There is deliberately **no cap on groups or on expenses per group**: the owner asked for two limits, both lists page properly, and an invisible ceiling is the defect the accounts list already has.

### `GET|PUT|DELETE /shared-groups/{id}`, `POST /shared-groups/{id}/restore`

The usual shape: reads resolve archived groups, `DELETE` archives and is idempotent, `restore` can rename in the same write. `PUT` changes `name`, `color` and `defaultSplit` — and **changing the default touches nothing already recorded**.

### `POST /shared-groups/{id}/participants` and `…/participants/preview`

The same body, once written and once only worked out. `applyToExistingExpenses` off — the default — puts the new people in what you add from now on and in none of what is there. On:

| The expense                    | What happens                                                            |
| ------------------------------ | ----------------------------------------------------------------------- |
| Follows the group's default    | Split again with the new default, everybody included                    |
| Carries its own `EQUAL`        | Re-divided: the mode itself says what a new head is worth               |
| Carries its own `FIXED_REST`   | The newcomer joins the unpinned rest                                    |
| Carries its own `PERCENT`      | **Left alone**: a percentage for somebody who was not there is invented |
| Carries its own `EXACT`        | **Left alone**, for the same reason                                     |

The answer counts those under `expenses.untouched`, so the screen can say it rather than leave it to be discovered. The alternative — giving the newcomer a zero share there — would put a row that owes nothing in the group's people list; the exact answer for an expense somebody was not at is that expense's own split.

A group whose default is `PERCENT` must send `defaultSplit` with the new percentages: the old ones no longer cover everybody. The group and every expense it re-splits move **in one transaction**, and every expense that is a movement of the user's records `SPLIT_EDITED` in that movement's history in the same write: what each person owes changed, even though what counts as yours did not ([transactions.md](transactions.md#its-history-sharedhistory)).

**What the preview does not carry yet:** what each person has already paid, who ends up ahead of what they owe, and what a written-off amount becomes. None of it exists on the server until payments and write-offs do; the shape is the one those tasks extend.

### `DELETE /shared-groups/{id}/participants/{contactId}`

Offered only while they have **no share in any live expense of the group**. Once one exists, taking them out would delete money or hand their share to everybody else in silence, so it is `400 PARTICIPANT_IN_USE`. In a `PERCENT` group their percentage is spread over the rest in proportion (largest remainder, so it adds up to 100 exactly); removal is only ever offered to somebody with no share anywhere, so this undoes a mistake rather than re-splitting anything.

### `GET|POST /shared-groups/{id}/expenses`, `GET|PUT|DELETE /shared-groups/{id}/expenses/{expenseId}`

The listing is **newest first, keyset over `(date, _id)`**: ids are minted when an expense is recorded, not on the day it was spent, so they cannot order this list on their own.

A create takes `description`, `date`, `amount`, an optional `paidByContactId` (null is you) and an optional `split`.

**Or it takes `transactionId`, and then the expense is a movement of yours.** The amount, the date and the description come from that transaction, so none of the three may be sent with it, and neither may a `paidByContactId` other than null: a movement of yours is a line you paid. The transaction has to be a live `EXPENSE` of the caller's, in the group's currency, and not already in a group (`400 TRANSACTION_ALREADY_SHARED`, `400 TRANSACTION_NOT_SPLITTABLE`, `400 CURRENCY_MISMATCH`, `404` for anything else). The expense and the link are written in **one database transaction**, and the transaction is read inside it, so two requests cannot both take the same movement. From then on its amount, date and description are edited on the transaction: restating one here is `400 SHARED_EXPENSE_LINKED`, and `DELETE` on the expense leaves the movement in place, whole and free. No `split` inherits the group's default and leaves `customSplit` false; a `split` sets it true. `PUT` either saves a split (`split`) or goes back to the group's (`useGroupSplit: true`) — never both — and changing the amount or the payer resolves the shares again rather than leaving figures that no longer add up.

**One case a caller has to know about:** an expense carrying its own `EXACT` split states amounts, so a new `amount` on its own makes them stop adding up and the write is `400 SPLIT_INVALID`. The request has to restate the split alongside the new amount. Rescaling what somebody typed by hand would be the server quietly deciding what they meant, which is worse than an error that says the shares no longer add up.

Every route under `/shared-groups/{id}/expenses/{expenseId}` checks that the expense really belongs to that group: reaching one of your own expenses through another of your groups is a URL that lies, and it answers 404 like any other resource that is not there.

`DELETE` is a **soft delete** (`deletedAt`) and is idempotent. A deleted expense counts in no total and appears in no listing. When it was a movement of yours, the movement is **not** deleted: it leaves the group and counts as yours in full again. Deleting the movement is what takes both.

## Storage

| Collection      | Index                                                   | Why                                                                |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `SharedGroup`   | `{ userId, _id }`                                       | Every read is user-scoped; the listing's keyset runs over `_id`    |
| `SharedGroup`   | `{ userId, name }` unique, active only, name collation  | One active group name per user, case folded                        |
| `SharedGroup`   | `{ userId, "participants.contactId" }`                  | "Which groups is this contact in", without scanning the user's     |
| `SharedGroup`   | `{ userId, updatedAt, _id }`                            | The keyset the offline change feed will scan                       |
| `SharedExpense` | `{ userId, groupId, deletedAt, date, _id }`             | The group's list in date order, its cursor, and the totals aggregation |
| `SharedExpense` | `{ userId, "split.shares.contactId" }`                  | Whether a contact holds a share, without scanning the group        |
| `SharedExpense` | `{ userId, updatedAt, _id }`                            | The keyset the offline change feed will scan                       |

Money is stored as integer cents, shares included; `percent` is not money and is stored as given, with the arithmetic rounding it to whole basis points.

**A group's totals cost one aggregation per page of groups**, not one per group, and they are not denormalised onto the group. Keeping a rollup in step across expense writes, participant re-splits and, later, payments and write-offs is far more to get wrong than a `$group` over an indexed range.

**Adding people is bounded by the size of one group.** Both the preview and the write read every live expense of the group and, when they apply, rewrite them in a single `bulkWrite` inside one transaction, which is what makes it all-or-nothing. A group is an outing or a trip, so that is tens of expenses; a group with thousands would hit MongoDB's 16 MB transaction limit and the whole operation would fail — loudly, with nothing half-applied, which is the right failure, but it is the ceiling this operation has. Capping expenses per group is the owner's call and has not been asked for.

## What This Module Does Not Do

- **It does not touch the user's money.** No balance, category or budget is read or written from here, and the only thing it knows about a transaction is whether one can be split into it.
- **It knows nothing about categories.** The shared layer carries none, on purpose: categories are private and never travel.
- **It has no payments, no write-offs and no `Settled` state.** All three are about money that came back, and a group is `Open` until something says otherwise — which is why the state is not stored as a field that could only ever hold one value today.
- **It does not sync.** Contacts, groups and expenses reach the offline mirror in the task that adds them to the change feed; the indexes they will need are already declared.
