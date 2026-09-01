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
- **~63 transactions** — 48 in the reference month plus two earlier months so
  stats and `?reference=` have somewhere to walk back to. Includes 3 quick-adds
  (`pendingDetails`, `source: QUICK`), a cash `ADJUSTMENT`, a transfer, and a
  salary.
- **10 budgets** — global, per-category, one with a per-period override, a
  `CUSTOM` one spanning the month, two expired and one archived.
- **2 refresh sessions** with different user agents, for the sessions screen.

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

The seed writes through the application services, never into Mongo directly, so
balances move atomically and every validation the API enforces applies here too.
Afterwards it reads the data back and asserts the five balances, the month total
and the session count; a drifted dataset fails the run instead of reaching the
frontend.

`src/__tests__/scripts/seedTest.test.ts` runs the command twice and checks that
nothing duplicates and that every id and total is identical. It needs a local
replica set; without one it reports the checks as skipped, which is what happens
in CI.

## The one hard delete

Re-seeding starts by **physically deleting** the fixture user and its documents.
This is the only sanctioned exception to the no-hard-deletes rule: soft-deleted
rows would keep holding the unique indexes (email, account name, budget period)
invisibly, so the second run could not rebuild the same state. It is scoped to
that single email, and the script refuses to run with `NODE_ENV=production`.
