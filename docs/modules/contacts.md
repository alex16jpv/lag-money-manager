# Contacts Module

## What This Module Does

Holds the people a user splits expenses with. A contact is **a private entity of the user's own**, not an account and not another user: it has a `name`, optionally a `color` and an `email`, and it is archived rather than deleted.

Two things set it apart from plain CRUD, and both are deliberate:

- **A contact is not an account.** It has no balance, no type, no credit limit and no currency, it never appears in `GET /accounts`, in a transfer, in `Stats groupBy=account` or in any total of what the user has or owes. Money only ever moves in the user's own accounts. Modelling a person as an account would have meant an "except for people" exception in each of the ten surfaces that already read accounts, and the one that got forgotten would teach a person as if they were a bank.
- **The `email` is an identifier, not a channel.** Nothing is sent from this API. It exists so a later delivery can invite that person to a shared group by address; until then it is a string the user typed. Two contacts may carry the same address — an invitation names a contact, never an address, so the ambiguity never arises.

`linkedUserId` is the seat that invitation will fill: it is always `null` today, it is server-owned, and a client that sends it has it dropped by validation. It is published in the contract so the frontend can already read it rather than have the shape change under it later.

## Files and Responsibilities

| File                                                           | Role                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/app/routes/contactRoutes.ts`                              | Route definitions with OpenAPI docs (CRUD at `/contacts` + restore)      |
| `src/app/controllers/ContactController.ts`                     | Thin HTTP handler, delegates to ContactService                           |
| `src/app/services/ContactService.ts`                           | Ownership checks, archive/restore, per-user cap, client-minted id replay |
| `src/app/dtos/ContactDTO.ts`                                   | `CreateContactDTO`, `UpdateContactDTO`                                   |
| `src/app/validation/schemas.ts`                                | `createContactSchema`, `updateContactSchema`                             |
| `src/domain/entities/Contact.ts`                               | Contact domain entity                                                    |
| `src/domain/repositories/contact/IContactRepository.ts`        | Repository interface                                                     |
| `src/infrastructure/repositories/contact/ContactRepository.ts` | Mongoose implementation                                                  |
| `src/infrastructure/models/ContactModel.ts`                    | Mongoose model and indexes (case-insensitive unique name)                |

## Public API

### `GET /contacts`

The user's contacts, paginated (offset + cursor).

| Parameter         | Type   | Description                                                |
| ----------------- | ------ | ---------------------------------------------------------- |
| `limit`           | number | 1–100, default 20                                          |
| `offset`          | number | Items to skip (offset pagination)                          |
| `cursor`          | string | Last ID of the previous page (overrides `offset`)          |
| `ids`             | string | Comma-separated list of contact UUIDs (1–100)              |
| `includeArchived` | enum   | `"true"` also returns archived contacts (hidden by default) |

> The list **pages from the first day**, on purpose. A contact list that silently stops at a fixed ceiling is the defect the accounts list already has, and this section is not allowed to repeat it. A `cursor` has to name a row the caller owns; one that names none is `400 INVALID_CURSOR`, never a silent page one.

> The order is **the order they were created in** (the keyset runs over the UUID v7 `_id`), the same as accounts and categories. It is not alphabetical: a client that wants a sorted picker has to say so, and sorting by name would be a keyset over `(name, _id)` with the index collation — a change worth making for all three lists at once, not for this one alone.

### `POST /contacts`

Create a contact. Requires `name` (1–255 chars, trimmed). Optional: `color`, `email`.

Active names are unique per user, **case-insensitively** — "Ana" and "ana" collide; accents stay distinct. Archiving a contact frees its name.

A user is capped at **200 active contacts** (`400 CONTACT_LIMIT_REACHED`), on this route **and on restore**: the contract calls the number the active contacts one user may have, so bringing an archived one back over the cap is refused rather than quietly making the published number false. The number lives in `MAX_CONTACTS_PER_USER` and is published in the contract as `SharedLimits.maxContactsPerUser`, because the sheet that adds a contact is meant to say the limit **before** a save can fail on it; a client that keeps its own copy will eventually say a different number from the server's.

**Client-minted `id` (optional).** Same rule as everywhere else: an id the user already owns replays with `200` and the stored contact whatever the payload says now; an id that belongs to another user is `409 ID_TAKEN`.

### `GET /contacts/:id`

One contact. Archived ones stay readable here (`archivedAt` tells them apart); only the listing hides them.

### `PUT /contacts/:id`

Partial update of `name`, `color`, `email`. `color` and `email` accept `null` to clear them — the field then leaves the document rather than staying in it as `null`, so "absent" is the only way something is unset. An archived contact is `400 RESOURCE_ARCHIVED`: restore it first.

### `DELETE /contacts/:id`

Archives the contact (`archivedAt`) and answers the archived row. **Nothing is ever hard-deleted**: the groups and the payments that name a contact have to stay readable, which is the whole reason this is a soft delete. Idempotent — archiving an already-archived contact answers it unchanged.

### `POST /contacts/:id/restore`

Un-archives, optionally under a new `name` (renamed in the same write, so nobody can take the name in between). Idempotent — restoring an active contact answers it unchanged, and that path spends no room against the cap because nothing becomes active.

Restoring an archived contact when the user is already at 200 active ones is `400 CONTACT_LIMIT_REACHED`: archive another one first.

## Concurrency

Every write accepts `If-Match: <updatedAt ISO>` and answers `409 STALE_UPDATE` with the server's copy in `current`, exactly as accounts and categories do. The version guard rides **inside the write's own filter**, not in a check before it, so a concurrent write cannot slip between the two.

## Storage

| Index                            | Why                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `{ userId: 1, _id: 1 }`          | Every read is user-scoped, and the listing's keyset runs over `_id`             |
| `{ userId: 1, name: 1 }` unique  | One **active** name per user (`partialFilterExpression: { archivedAt: null }`), with the `es` strength-2 collation that folds case and keeps accents |
| `{ userId: 1, updatedAt: 1, _id: 1 }` | The keyset the offline change feed will scan. Declared with the model so the index exists before the feed reads it |

`email` carries **no** uniqueness constraint: an invitation names a contact, so two contacts sharing an address is ambiguous to nobody, and refusing it would be a rule the product never asked for.

## What This Module Does Not Do

- It does not send anything, anywhere. See `email` above.
- It does not know about groups, splits or money. That is the shared-groups module; a contact only ever appears there by id.
- It does not link a contact to a real user. `linkedUserId` stays `null` until the invitation flow exists.
