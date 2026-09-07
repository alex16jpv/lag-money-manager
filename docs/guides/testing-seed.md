# Deterministic Test Seed

```bash
docker compose up -d mongo
npm run seed:test
```

Builds one known user whose accounts, categories, transactions and budgets
reproduce the dataset the designs were drawn from, so the frontend's end-to-end
tests and screenshot comparisons run against fixed data. Every run leaves the
database in the same state.

## Credentials

| | |
| --- | --- |
| Name | `John Doe` (the neutral example name the owner chose; the front uses the same one) |
| Email | `seed@ledgerflow.test` |
| Password | `LedgerFlow!2026` |
| Timezone / currency / locale | `America/Bogota` · `COP` · `en` |

## What it creates

- **5 accounts** — Bancolombia (main), Cash, Visa Gold, Savings, and an
  archived Nequi. The final balances are the designed ones; the **opening
  balances are derived from them**, so the numbers come out of the real
  transaction flow rather than being written by hand.
- **14 categories** — the ten defaults plus Coffee, Health, Pets (unused on
  purpose) and an archived Vacation still referenced by a budget, which is how
  `archivedCategoryIds` shows up.
- **~66 transactions** — 48 in the reference month plus two earlier months so
  stats and `?reference=` have somewhere to walk back to. Includes 3 quick-adds
  (`pendingDetails`, `source: QUICK`), a cash `ADJUSTMENT`, a transfer, and a
  salary. **Three of them are deleted** after being created (two expenses and a
  quick-add), which is where the change feed gets its transaction tombstones.
- **10 budgets** — global, per-category, one with a per-period override, a
  `CUSTOM` one spanning the month, two expired and one archived. The recurring
  ones carry an `effectiveFrom` before the oldest seeded month: a budget's
  lifetime floor defaults to its creation date, which would hide it exactly
  where the seeded transactions live.
- **2 refresh sessions** with different user agents, for the sessions screen.

## Ready for `GET /sync/changes`

The offline mirror pulls everything that changed after a position, so a dataset
where every row shares one instant is useless to it: a `since` either returns
the whole database or nothing, and an incremental pull looks correct whatever it
does. The seed therefore ends with two passes that make the data reportable.

- **`updatedAt` and `createdAt` are spread** over a window that opens 14 days
  before the reference day and closes the day before it — never "now", and never
  in the future, since the feed's cursor deliberately lags the server clock by
  60 s. They are written **through the driver**: Mongoose's timestamps stamp
  every save with the current instant, which is the state being undone.
- **A group of 6 rows shares one exact instant.** The feed pages on
  `(updatedAt, _id)`, and a page boundary that falls inside a single instant is
  what drops rows; without a shared instant the tie-break is never exercised.
- **Every entity carries a tombstone**: an archived account (Nequi), an archived
  category (Vacation), an archived budget (Retired budget) and three deleted
  transactions. Rows that were archived or deleted are stamped as touched a few
  hours after they were created, because that is what happened to them.

The `sync` block of `seed-test.output.json` records the window, the shared
instant and the tombstone counts, and the seed refuses to finish if a `since` in
the middle of its own window returns all of the transactions or none of them.

Draining the feed against the seeded database (95 rows, one user):

```
snapshot limit=7:     95 rows in 14 pages, 0 duplicates, 6 tombstones
snapshot limit=1000:  95 rows in  1 page,  0 duplicates, 6 tombstones
since=<mid-window>:   32 rows in  7 pages, 0 duplicates, 3 tombstones
```

Ids are fixed UUIDs, including those of the ten seeded categories: the seed
recreates them so a fixture can reference a category by id.

## Output

`scripts/seed-test.output.json` (gitignored) holds every id, the reference month
and the expected totals, for the frontend to import instead of duplicating the
constants.

## The reference month

Dates are anchored to a reference day — today by default, or `SEED_TODAY`:

```bash
SEED_TODAY=2026-09-22 npm run seed:test
```

`SEED_TODAY` cannot be in the future: the API rejects dates more than 24 hours
ahead (`FUTURE_DATE`), so the seed would fail halfway. And when the reference
day falls too early in its month to hold the dataset, the seed uses **the
previous, complete month** and says so — `referenceMonthShifted` in the output
records it.

The month's spending totals are load-bearing, since the designs display them:

| Category | Total |
| --- | --- |
| Food | 412 000 |
| Lifestyle | 356 000 |
| Transport | 185 500 |
| Bills | 186 200 |
| Coffee | 98 400 |
| Uncategorised (the quick-adds) | 47 900 |
| **Month** | **1 286 000** |

> The design brief quotes ≈1 284 300 for the month, but the sum of its own
> per-category figures is 1 286 000. The per-category numbers were taken as
> authoritative, since each is displayed on its own screen.

## Guarantees

The seed writes through the application services, so balances move atomically
and every validation the API enforces applies here too. The one exception is the
final timestamp pass, which goes through the driver on purpose: `createdAt` and
`updatedAt` cannot be set through Mongoose, whose timestamps overwrite them on
every save.
Afterwards it reads the data back and asserts the five balances, the month
total, the session count and the sync spread; a drifted dataset fails the run
instead of reaching the frontend.

The deleted transactions are excluded from the balance arithmetic: deleting
reverses what a transaction moved, so a row that ends up deleted moves nothing
and the designed final balances still land exactly.

`src/__tests__/scripts/seedTest.test.ts` runs the command twice and checks that
nothing duplicates, that every id and total is identical, and that the result is
sync-ready: `updatedAt` spread over more than one instant, one group sharing an
instant, a tombstone per entity and nothing stamped in the future. It needs a
local replica set; without one it reports the checks as skipped, which is what
happens in CI.

## The one hard delete

Re-seeding starts by **physically deleting** the fixture user and its documents.
This is the only sanctioned exception to the no-hard-deletes rule: soft-deleted
rows would keep holding the unique indexes (email, account name, budget period)
invisibly, so the second run could not rebuild the same state. It is scoped to
that single email, and the script refuses to run with `NODE_ENV=production`.
