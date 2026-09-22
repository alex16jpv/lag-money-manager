# Notifications Module

> **Status: defined, not built, and not scheduled.** This is the design the module is meant to be
> built to (T-125). Nothing below exists in `src/`: the server side is T-127, the inbox T-128, email
> T-131 and push T-132, and the owner may redo this definition from scratch when that work starts.
> **Shared invitations do not wait for it**: an invitation is its own entity, shown and answered
> inside Shared, and the day this module exists its route adds the `notify()` call described below
> and nothing else changes.

## What This Module Does

Tells a user something they would otherwise not see: somebody invited them to a shared group,
somebody answered their invitation, somebody changed a group they are in — and, later, that one of
their budgets crossed a line. It is a system of its own, not a piece of Shared: budget alerts and
whatever comes later are new **types** of the same thing, and email and push are new **channels** of
it.

Three rules shape everything else:

1. **A notification owns no state.** It points at a subject — an invitation, a group, a budget — and
   the subject is the truth. Losing a notification loses nothing but the news: the invitation is
   still pending in its own collection, the group still lists its expenses. This is what allows them
   to expire (see _Retention_).
2. **Only the server produces them.** A device never mints a notification, including the ones it
   could work out alone (see _Who produces them_). That is how the same news can never arrive twice.
3. **Nothing interrupts.** Arriving is a count on a bell and a dot on the navigation, and nothing
   else: no toast, no modal, no sound. Push is the one channel that reaches a person outside the
   app, and it only exists for someone who switched it on.

## The row

| Field                       | Meaning                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                        | UUID v7, minted by the server                                                                                                        |
| `userId`                    | The recipient. Every read and every index starts with it                                                                             |
| `type`                      | One entry of the registry below                                                                                                      |
| `params`                    | What that type carries, validated by its strict schema                                                                               |
| `inApp`                     | `false` when the person had this topic switched off in the app when it was produced (see _Preferences_). The client does not show it |
| `lastEventAt`               | When the last thing it tells happened. The inbox is ordered by it, and a folded row moves it                                         |
| `seenAt` · `readAt`         | See _States_                                                                                                                         |
| `resolvedAt` · `resolution` | See _States_. Only on a type that waits for an answer                                                                                |
| `expiresAt`                 | See _Retention_                                                                                                                      |
| `openKey` · `onceKey`       | Server-internal keys for _Folding_ and idempotency. Never sent                                                                       |
| `createdAt` · `updatedAt`   | As everywhere; `updatedAt` is what the change feed orders by                                                                         |

## The catalog of types

A type is one entry in a registry (`NOTIFICATION_TYPES` in `src/shared/constants.ts`) that declares:

| Field      | Meaning                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topic`    | The group a person switches on and off in Settings (see _Preferences_). Several types can share one                                                                        |
| `audience` | Who receives it, as a rule of the domain: the invitee, the inviter, the participants except the author, the budget's owner                                                 |
| `params`   | A strict Zod schema for what the row carries. It goes into the OpenAPI document as one branch of a discriminated union on `type`, so the front generates its types from it |
| `action`   | `none`, or `answer` for a type that waits for the recipient (an invitation). Only these are ever _resolved_                                                                |
| `fold`     | `none`, or the key that folds several events into one row while it is unread (see _Folding_)                                                                               |
| `once`     | The key that makes producing it idempotent: the same key for the same recipient produces nothing the second time                                                           |
| `channels` | The channels it may go out on and their defaults                                                                                                                           |

**Adding a type touches the registry and the client's messages, never the transport**: the entity,
its indexes, the feed, the batch operations and the delivery queue do not know which types exist.

**The row carries facts, not text.** `params` hold the ids the client needs to link to the subject
and a snapshot of the names it needs to write the sentence, **as they were when it happened**. The
sentence is written by the client, in the user's language, from `messages/`. A snapshot rather than
a lookup, because the recipient may no longer be able to read the subject (a group archived by its
owner, an invitation withdrawn) and the notification still has to say what happened.

**A name is the one the recipient already knows.** The inviter reads the invitee under the name of
their own contact, never under the profile name the other person chose, which the inviter never had;
a participant reads another participant as the group names them. What a guest is shown for the
group's owner is T-130's decision, and the snapshot follows it.

**A payload carries only what its recipient may already read.** It is the frontier of the shared
layer ([sync.md](sync.md), _The shared layer travels whole_) applied to a second collection: no
account, no category, no note, no amount that counts as somebody's own, no `countsAsYours`, no link
to a movement. The per-type `params` schemas are strict, so a field that is not declared cannot leak
in by accident, and T-127 holds that with a test over every entry.

### The types of this delivery

| `type`                      | Audience                                             | Topic               | `action` | `fold`                  | `once`                     | Built by |
| --------------------------- | ---------------------------------------------------- | ------------------- | -------- | ----------------------- | -------------------------- | -------- |
| `sharedInvitation.received` | The invited person                                   | `sharedInvitations` | `answer` | none                    | `invitation:<id>:received` | T-127    |
| `sharedInvitation.answered` | Whoever invited                                      | `sharedActivity`    | none     | none                    | `invitation:<id>:answered` | T-127    |
| `sharedGroup.activity`      | Every participant with an account, except the author | `sharedActivity`    | none     | `sharedGroup:<groupId>` | none — it folds instead    | T-127    |

`params`, in outline (each task fixes its own schema):

- `sharedInvitation.received` — `invitationId`, `groupId`, `groupName`, `inviterName`, and the
  invitation's own `expiresAt` if T-129 gives invitations a lifetime.
- `sharedInvitation.answered` — `invitationId`, `groupId`, `groupName`, `inviteeName`, `answer`
  (`accepted` | `declined`).
- `sharedGroup.activity` — `groupId`, `groupName`, `count`, `lastKind` (`expenseAdded`,
  `expenseChanged`, `expenseRemoved`, `paymentRecorded`, `groupArchived`), `lastActorName`.

Whoever builds this may add a type Shared turns out to need, by the rule above; never a field that
crosses the frontier.

### The next family: budgets

Budget alerts are the reason this is a system and not a piece of Shared, and they are **not in the
registry until a task builds them**: a type nobody produces is a promise the contract cannot keep.
When they come they are one topic, `budgets`, with types such as `budget.threshold` (`budgetId`,
`budgetName`, `periodKey`, `threshold`), whose audience **is the author** — the movement that
crosses a budget is always the person's own — and whose `once` is `budget:<id>:<periodKey>:<threshold>`,
so each threshold of each period is said once.

**What that task has to pay for:** producing it where a movement lands means knowing that budget's
`spent` on every write that could move it — one aggregation per budget the movement falls in, on
the hottest path of the API (house rule 23). It is measured before it is built, not after.

## Who produces them

`NotificationService.notify(recipientId, type, params, session)` is called **by the service whose
write is the event, inside that write's own transaction**: the invitation and the notification of
the invitation commit together or not at all. There is no event bus and no second step that can
fail after the first one committed.

**Who receives it is the type's `audience`, not a general rule.** The shared types never tell the
author about their own write, from any device; a budget alert is only ever about the author's own
movement.

**What a device could work out alone is still produced only here.** A budget crossed offline is the
clearest case: the phone knows, because the budget screen projects it. It still does not mint the
notification — the server does, when the batch carrying that movement lands, through the same
service the route calls. The price is that an alert about something recorded offline arrives once
it syncs; what the person needs meanwhile is already on the screen they are looking at, which never
waits for the server. The alternative — the device mints it with a deterministic id and the server
merges — makes two producers agree on a threshold computed from two clocks and two copies of the
data, and the day they disagree the same news arrives twice or never.

**Idempotent by upsert, never by catching the error.** A duplicate-key error inside a MongoDB
transaction aborts the whole transaction, the invitation included. So a type with `once` is written
as an upsert on `{userId, onceKey}` with everything under `$setOnInsert`: a batch replayed after a
lost response, or two services reaching the same fact, find the row and change nothing. The folding
upsert of the next section is the same shape. Two of them racing on the same key can still meet a
write conflict, which MongoDB reports as `TransientTransactionError`; the unit of work retries it,
and that retry is part of what T-127 tests against a real mongod.

**A notification produced by somebody else's action is written into another user's data.** It is the
first write in this API whose `userId` is not the requester's, so two guards come with it: the
service only ever writes a row whose recipient the type's audience named, and what an outsider can
trigger is bounded by what that outsider can do — T-129 caps pending invitations per inviter, so
nobody can fill a stranger's inbox.

## States, and who moves them

The five the owner named, and what each became:

| Asked for     | Here                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **delivered** | Not a state of the notification: in the app the row existing is the delivery; for email and push it is the state of the **delivery** (_Channels_) |
| **seen**      | `seenAt`                                                                                                                                          |
| **read**      | `readAt`                                                                                                                                          |
| **attended**  | `resolvedAt` with its `resolution`, only on a type that waits for an answer                                                                       |
| **archived**  | Left out — see below                                                                                                                              |

| Field                       | Set by                                     | Meaning                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seenAt`                    | The recipient                              | The row was on screen in the inbox. **Seen is what the count counts**: opening the inbox clears the bell                                                                                                  |
| `readAt`                    | The recipient, or the server on resolution | They opened this one, answered it, or said "Mark all as read". An unread row keeps its emphasis in the inbox after the bell is clear                                                                      |
| `resolvedAt` · `resolution` | **Only the server**                        | The subject no longer waits for this person, and how it ended: `accepted`, `declined` or `withdrawn`. Set in the same transaction as the invitation's own change, from whichever device or person made it |

**Why seen and read are both kept.** One clears the count, the other says what is still worth
opening: an invitation seen on Monday and not answered is still the row that stands out on Friday.
Collapsing them makes opening the inbox either wipe every emphasis or never clear the bell.

**Why the outcome is on the row.** The invitee cannot read the invitation — it is the inviter's —
and the snapshot in `params` was taken before anybody answered, so the row is the only place the
client can learn how it ended.

**An invitation that runs out of time is not resolved by the server**, because nothing wakes the
server at that moment and house rule 24 rules out a timer for it. If T-129 gives invitations a
lifetime, their `expiresAt` travels in `params`, the client shows "No longer available" past it by
its own clock, and the notification's own `expiresAt` is set at creation from it (_Retention_). The
invitation's route refuses an answer after it, which is the rule that actually matters.

**Archived / dismissed was left out**, because a state nobody reads is debt: the inbox empties itself
(_Retention_) and a read row already steps back, and a person who wants an invitation gone answers
it. If people ask to clear rows, it is one more field and one more batch action, and nothing else
moves.

The server stamps `seenAt` and `readAt` with its own clock when the operation lands; the device's
`occurredAt` is data, as everywhere in the batch.

## Folding

Eight expenses added to a trip are one notification, not eight. A type with a `fold` key keeps
**one open row per recipient and key**: while that row is unread, a new event updates it instead of
inserting — `count` goes up, `lastKind`, `lastActorName` and `lastEventAt` move, `seenAt` is cleared
so the count says there is news again — and the row rises to the top of the inbox. Once it is read,
the next event opens a new row.

The guarantee is an index, not a read-then-write: `openKey` is present only on a row that still
folds, and `{userId, openKey}` is unique over the rows that carry it. The producer is one atomic
upsert on it; marking a row read `$unset`s the key in the same write.

## Retention

| Row                                           | `expiresAt`                                    |
| --------------------------------------------- | ---------------------------------------------- |
| Informative (`action: none`)                  | 90 days after `lastEventAt`                    |
| Waiting for an answer, invitation with no end | none — it stays while the invitation waits     |
| Waiting for an answer, invitation that ends   | 30 days after the invitation's own `expiresAt` |
| Resolved                                      | 30 days after `resolvedAt`                     |

A TTL index on `expiresAt` (`expireAfterSeconds: 0`) removes them; a row with no `expiresAt` never
expires. **This is an exception to the house rule that nothing is deleted**, and rule 1 above is why
it is safe: what goes is the news, never the fact. Retention was part of what the owner asked of this
system from the start, and the idempotency store (`syncops`, 30 days) is the precedent.

**The feed never reports an expiry**, which would break a mirror that only learns about
disappearances from `archivedAt`/`deletedAt` ([sync.md](sync.md)). It does not have to: `expiresAt`
travels on the row, so the client knows the date in advance, stops showing the row when it passes
and removes it from its copy, by its own clock, before or after MongoDB's TTL monitor gets to it.

## How they reach the device

**Through the feed that already exists**, as one more source of `GET /sync/changes` (`notifications`),
and marked through the batch that already exists. The feed is per user by design, and a
notification belongs to exactly one user — its recipient — so it is the one entity of the second
delivery that raises no question of what may travel.

The alternative, an endpoint of its own polled for news, was rejected: a second pull cycle with a
second cursor, a second cache for offline, and requests that the feed already makes for nothing.
Pulled with everything else, a notification costs no request of its own — only one more keyset read
per page of the feed, over the `(userId, updatedAt, _id)` index every source carries.

**It arrives when the app pulls**: on opening, on regaining focus once the copy is five minutes old,
and when the network comes back — never on a timer (house rule 24). An invitation sent while the
other person has the app open reaches them the next time one of those happens. Arriving while the
app is closed is what push is for.

### The operations

| Batch `entity:action`      | HTTP route                     | Body       | Effect                                                                    |
| -------------------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------- |
| `notification:markSeen`    | `POST /notifications/seen`     | `{ upTo }` | `seenAt` on every row of the user with `lastEventAt ≤ upTo` that has none |
| `notification:markRead`    | `POST /notifications/:id/read` | —          | `readAt` on that row, and `seenAt` if missing                             |
| `notification:markAllRead` | `POST /notifications/read`     | `{ upTo }` | `readAt` (and `seenAt`) on every row up to `upTo`                         |

`upTo` is the `lastEventAt` of the newest row the device **showed**, verbatim from the feed — a
server timestamp, so the comparison never involves the device's clock. It is a bound and not a list
of ids because a folded row can rise again after it was shown: marking "everything I saw" by the
time it had then leaves the new event unseen, as it should be. The batch's `id` for the two bulk
actions is the id of that newest row, which only names the operation; the body is what decides.

**What the bound gets wrong, and why it is accepted.** Application servers stamp `lastEventAt` with
their own clocks, which can drift ([sync.md](sync.md), _Paging_): a row written by a slower instance
just after the device pulled can carry a time at or below `upTo` and be marked seen without having
been shown. What that costs is the bell, never the news: `markSeen` does not touch `readAt`, so the
row still stands out as unread in the inbox. `markAllRead` is the one that could hide it, and it is
an explicit gesture over what the person just looked at, with the same 60-second exposure the feed
already accepts.

All three are idempotent — a row already seen or read is left as it is — so a replay or a second
device marking the same rows changes nothing. Every row they touch gets a new `updatedAt`, so the
other devices of the same person clear their bell on their next pull.

`GET /notifications` lists them newest first, keyset-paginated over `(lastEventAt, _id)`. It is the
fallback path of a device that has not finished its first snapshot, as the other listings are
([sync.md](sync.md), _What the offline client still needs_). It carries **no count**: the client
counts the rows it can show, and a count from the server would include types that client does not
know.

### What the client does with them

The mirror gains a `notifications` store (a `MIRROR_VERSION` bump); the count is derived from it —
rows with no `seenAt`, `inApp` not false, not expired, of a type the client knows. Marking is an
outbox write that projects at once, so the bell clears offline and stays clear. **A type the client
does not know is left out of the inbox and of the count alike**, by the same filter: an older app
cannot write a true sentence about it, and a count of rows the inbox does not show is a count that
lies. In local-only mode ("This device only") there is no server and so no notification; the inbox
says so rather than showing an empty list.

## Preferences

Per **topic** and per **channel**, stored on the user's profile as overrides over the registry's
defaults (`notificationPreferences: { [topic]: { [channel]: boolean } }`), so the profile only
carries what the person changed and a new topic arrives with its default. The profile already
travels in the feed (`changes.user`), so every device knows them; writing them is a profile write,
online only, like the rest of Settings.

| Topic               | Types                                               | In the app | Can it be switched off in the app?                                                                                                                   |
| ------------------- | --------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharedInvitations` | `sharedInvitation.received`                         | on         | **No**: an invitation that is never shown can never be answered, and the inviter is left waiting on nothing. Email and push, when they exist, can be |
| `sharedActivity`    | `sharedInvitation.answered`, `sharedGroup.activity` | on         | Yes                                                                                                                                                  |

**A preference is applied when a notification is produced, not when it is read.** Switching a topic
off stops what comes next; it does not hide what already arrived. **The row is always written**,
because it is what every delivery hangs on: with a topic off in the app and on by email, the email
still needs its notification. What the in-app switch decides is `inApp`, stamped on the row at
production — `false` and the client neither shows nor counts it. A notification with every channel
off is not written at all.

Where it lives on screen: the client's Settings › Preferences › **Notifications**, one row per topic
with one switch per channel that exists — only "In the app" until T-131.

## Channels

In the app is the notification itself. Every other channel is a **delivery**:

| Field                                    | Meaning                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `notificationId`, `userId`, `channel`    | Which notification, to whom, by which way. Unique per `(notificationId, channel)` |
| `status`                                 | `queued` → `sent` · `failed` · `skipped`                                          |
| `attempts`, `nextAttemptAt`, `lastError` | Retries with backoff, and the last reason it did not go out                       |

`notify()` writes the deliveries **in the same transaction** as the notification, one per channel
that the type allows and the person's preferences leave on — the transactional outbox pattern, so a
delivery never exists without its notification and a notification never misses a delivery it was
owed. A folded row does not enqueue a new delivery on every event: that is the point of folding,
and each channel decides in its own task how it summarises.

**What T-127 leaves ready without building a channel**: the channel list (`NOTIFICATION_CHANNELS`,
`inApp` alone), the per-type `channels` in the registry, the preference shape keyed by channel, the
`notificationdeliveries` collection with its indexes, and the enqueue step in `notify()`, tested with
a channel that exists only in the tests. With no external channel it enqueues nothing, which is the
truth. T-131 adds `email` and T-132 `push`: a value in the list, a sender, and the Settings column.

**What a sender needs that this repository does not have yet.** The back runs as a Lambda: there is
no process that stays up to drain a queue. The sender is either invoked after the transaction
commits, with the queue as the retry net, or a scheduled invocation — and a schedule wakes the cloud
on a timer, which house rule 24 only allows when there is work. That choice is T-131's; this module
only guarantees the queue is there and is honest.

## Storage

| Index                                                            | Why                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `{ userId: 1, lastEventAt: -1, _id: -1 }`                        | The inbox listing and its keyset                        |
| `{ userId: 1, updatedAt: 1, _id: 1 }`                            | The change feed ([sync.md](sync.md)); no partial filter |
| `{ userId: 1, openKey: 1 }` unique, partial on `openKey` present | One open folding row per recipient and key              |
| `{ userId: 1, onceKey: 1 }` unique, partial on `onceKey` present | Producing the same news twice produces nothing          |
| `{ expiresAt: 1 }`, `expireAfterSeconds: 0`                      | Retention                                               |
| deliveries: `{ notificationId: 1, channel: 1 }` unique           | One delivery per channel                                |
| deliveries: `{ status: 1, nextAttemptAt: 1 }`                    | What a sender picks up next                             |

## What This Module Does Not Do

- It does not own any state of the things it talks about. Accepting an invitation is the
  invitation's route, not this module's.
- It does not decide what a guest may see of a group. That is T-130; this module only carries what
  the recipient may already read.
- It does not send email or push today. See _Channels_.
