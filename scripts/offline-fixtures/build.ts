/**
 * Builds `fixtures/offline/` from the scenarios: `npm run fixtures:offline`.
 *
 * That directory is the committed contract between the backend's aggregations
 * and the frontend's local derivations (O-F3). The backend's mongod suite
 * reads it; the frontend vendors it verbatim (`npm run fixtures:sync` there).
 * Nothing in it is hand-edited: `npm run fixtures:check` rebuilds into memory
 * and fails when the committed files differ, so a rule changed here travels
 * with its fixture in the same commit (offline plan, invariant 6).
 *
 * The output is byte-stable: no timestamps, no ids that move between runs.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { DateTime } from "luxon";
import { join } from "path";

import {
  deriveBalances,
  deriveBudgetViews,
  deriveList,
  derivePending,
  deriveSpending,
  resolvePeriod,
} from "./derive";
import { fixtureId, SCENARIOS } from "./scenarios";
import {
  ExpectedList,
  ExpectedSpending,
  Fixture,
  FixtureAccount,
  FixtureBudget,
  FixtureCategory,
  FixtureTransaction,
  Scenario,
} from "./types";

export const OUT_DIR =
  process.env.OFFLINE_FIXTURES_DIR ?? join(__dirname, "../../fixtures/offline");

const GENERATED_BY =
  "lag-money-manager · scripts/offline-fixtures · npm run fixtures:offline";

/** Same offset the row was authored with, so the JSON stays readable. */
const shiftIso = (iso: string, days: number): string => {
  const shifted = DateTime.fromISO(iso, { setZone: true }).plus({ days });
  const out = shifted.toISO();
  if (!out) throw new Error(`Unparseable date: ${iso}`);
  return out;
};

function buildFixture(scenario: Scenario, index: number): Fixture {
  const { user } = scenario;
  const decimals = user.minorUnits;

  const accounts: FixtureAccount[] = scenario.accounts.map((a, i) => ({
    key: a.key,
    id: fixtureId(index, "a", i + 1),
    name: a.name,
    type: a.type,
    color: a.color,
    currency: user.currency,
    openingBalance: a.openingBalance,
    isDefault: a.isDefault === true,
    // Archived rows carry a stamp: the sync feed is the only place it ever arrives.
    archivedAt: a.archived === true ? scenario.reference : null,
  }));

  const categories: FixtureCategory[] = scenario.categories.map((c, i) => ({
    key: c.key,
    id: fixtureId(index, "c", i + 1),
    name: c.name,
    type: c.type,
    archivedAt: c.archived === true ? scenario.reference : null,
  }));

  const accountId = (key: string | undefined): string | null => {
    if (key === undefined) return null;
    const found = accounts.find((a) => a.key === key);
    if (!found) throw new Error(`${scenario.id}: unknown account ${key}`);
    return found.id;
  };
  const categoryId = (key: string | undefined): string | null => {
    if (key === undefined) return null;
    const found = categories.find((c) => c.key === key);
    if (!found) throw new Error(`${scenario.id}: unknown category ${key}`);
    return found.id;
  };
  const defaultAccount = accounts.find((a) => a.isDefault);

  const transactions: FixtureTransaction[] = scenario.transactions.map(
    (t, i) => {
      if (t.quick === true && !defaultAccount) {
        throw new Error(`${scenario.id}: a quick-add needs a default account`);
      }
      assertPrecision(scenario, t.key, t.amount, decimals);
      return {
        key: t.key,
        id: fixtureId(index, "t", i + 1),
        type: t.type,
        amount: t.amount,
        date: t.date,
        dayKey: DateTime.fromISO(t.date, { setZone: true })
          .setZone(user.timezone)
          .toFormat("yyyy-MM-dd"),
        description: t.description ?? null,
        categoryId: t.quick === true ? null : categoryId(t.category),
        // The server charges a quick-add to the default account, so the fixture spells out where it landed.
        fromAccountId:
          t.quick === true ? (defaultAccount?.id ?? null) : accountId(t.from),
        toAccountId: t.quick === true ? null : accountId(t.to),
        tags: t.tags ?? [],
        currency: user.currency,
        source: t.quick === true ? "QUICK" : "MANUAL",
        pendingDetails: t.quick === true,
        deletedAt: t.deleted === true ? shiftIso(t.date, 1) : null,
        note: t.note,
      };
    },
  );

  const reference = new Date(scenario.reference);
  const budgets: FixtureBudget[] = scenario.budgets.map((b, i) => {
    assertPrecision(scenario, b.key, b.amount, decimals);
    const stored = {
      key: b.key,
      id: fixtureId(index, "b", i + 1),
      name: b.name,
      type: b.type ?? ("EXPENSE" as const),
      categoryIds: b.categories.map((key) => {
        const id = categoryId(key);
        if (id === null) throw new Error(`${scenario.id}: unknown ${key}`);
        return id;
      }),
      amount: b.amount,
      amountOverrides: {} as Record<string, number>,
      currency: user.currency,
      periodType: b.periodType,
      periodStartDate: b.periodStartDate ?? null,
      periodEndDate: b.periodEndDate ?? null,
      effectiveFrom: b.effectiveFrom ?? null,
      archivedAt: b.archived === true ? scenario.reference : null,
      note: b.note,
    };
    if (b.override !== undefined) {
      assertPrecision(scenario, b.key, b.override, decimals);
      // Overrides are keyed by period, so the key format is part of this contract.
      stored.amountOverrides[
        resolvePeriod(stored, reference, user.timezone).key
      ] = b.override;
    }
    return stored;
  });

  const categoryIdsOf = (keys: string[] | undefined): string[] | null => {
    if (keys === undefined) return null;
    return keys.map((key) => {
      const id = categoryId(key);
      if (id === null) throw new Error(`${scenario.id}: unknown ${key}`);
      return id;
    });
  };

  const spending: ExpectedSpending[] = scenario.spending.map((q) => {
    if (q.splitBy && !["month", "account"].includes(q.groupBy)) {
      throw new Error(
        `${scenario.id}/${q.name}: the API refuses splitBy with groupBy=${q.groupBy}`,
      );
    }
    if (q.splitBy && !(q.from && q.to)) {
      throw new Error(`${scenario.id}/${q.name}: a split needs a window`);
    }
    const query = {
      groupBy: q.groupBy,
      splitBy: q.splitBy ?? null,
      categoryIds: categoryIdsOf(q.categories),
      type: q.type ?? null,
      from: q.from,
      to: q.to,
      timezone: user.timezone,
    };
    const derived = deriveSpending(transactions, query);
    if (q.groupBy !== "day" && q.groupBy !== "month") {
      assertNoTies(scenario, q.name, derived.buckets);
    }
    return { name: q.name, query, ...derived, note: q.note };
  });

  const lists: ExpectedList[] = scenario.lists.map((q) => {
    const query = {
      sort: q.sort,
      order: q.order,
      categoryIds: categoryIdsOf(q.categories),
      type: q.type ?? null,
      from: q.from,
      to: q.to,
      timezone: user.timezone,
      limit: q.limit,
    };
    return {
      name: q.name,
      query,
      transactionIds: deriveList(transactions, query),
      note: q.note,
    };
  });

  return {
    id: scenario.id,
    title: scenario.title,
    pins: scenario.pins,
    generatedBy: GENERATED_BY,
    user,
    accounts,
    categories,
    transactions,
    budgets,
    expected: {
      balances: deriveBalances(accounts, transactions),
      pending: derivePending(transactions),
      spending,
      lists,
      budgets: {
        reference: scenario.reference,
        views: deriveBudgetViews(
          budgets,
          transactions,
          categories,
          reference,
          user.timezone,
        ),
      },
    },
  };
}

function assertPrecision(
  scenario: Scenario,
  key: string,
  amount: number,
  decimals: number,
): void {
  const factor = 10 ** decimals;
  if (Math.abs(amount * factor - Math.round(amount * factor)) > 1e-9) {
    throw new Error(
      `${scenario.id}/${key}: ${amount} has more decimals than ${scenario.user.currency} allows — the API would refuse it`,
    );
  }
}

/**
 * A ranked grouping breaks a tie by key, on both sides of the contract, so a
 * tie is no longer ambiguous — but a fixture nobody has to reason about is
 * worth more than one that exercises the rule, so a scenario with two equal
 * BUCKET totals is refused — the ranked groupings only, since day and month
 * come back by key. Splits are not checked: they are ranked by the same rule,
 * and `offlineFixtures.test.ts` pins both orders directly. Ordered LISTS are
 * the opposite: one carries a deliberate tie, because there the tiebreak is
 * the contract.
 */
function assertNoTies(
  scenario: Scenario,
  name: string,
  buckets: { key: string; total: number }[],
): void {
  const seen = new Map<number, string>();
  for (const b of buckets) {
    const other = seen.get(b.total);
    if (other !== undefined) {
      throw new Error(
        `${scenario.id}/${name}: ${other} and ${b.key} both total ${b.total}; the sort order between them is undefined`,
      );
    }
    seen.set(b.total, b.key);
  }
}

function readme(fixtures: Fixture[]): string {
  const lines: string[] = [
    "# Offline parity fixtures",
    "",
    `> Generated by ${GENERATED_BY}. **Do not hand-edit**: rebuild instead.`,
    "",
    "The contract between the figures the backend computes and the ones the app",
    "derives on the device with no network (`lib/local/derive`, O-F3). Each file",
    "holds a set of rows and the figures they must produce. The canonical copy is",
    "`fixtures/offline/` in lag-money-manager: `npm run fixtures:check` fails its CI",
    "when the generator and these files disagree, and",
    "`src/__tests__/mongo/parityFixtures.mongo.test.ts` checks the real services",
    "against them on a real mongod. The frontend vendors the folder verbatim in",
    "`ledger-flow/lib/local/derive/fixtures/` (`npm run fixtures:sync` there) and",
    "feeds it to its pure derivations. When a figure here changes, both sides",
    "change with it — invariant 6 of `OFFLINE-SYNC-PLAN.md §10`.",
    "",
    "## The rules the figures follow",
    "",
    "- **Add in minor units.** Every amount is a decimal in the currency's own unit,",
    "  as the API prints it. Multiply by 100, round, add as integers, divide once at",
    "  the end. As a running float sum, `1000 − 10.10 + 1500 − 7.77 − 100 − 3.45` is",
    "  `2378.6800000000003`; in minor units it is `2378.68`, the `current` balance",
    "  of `eur-madrid`. (Most short sums happen to come back exact in floats — that",
    "  is what makes the rule easy to skip and hard to see.)",
    "- **Windows are half-open `[from, to)`** and built in the **user's timezone**. A",
    "  month is `[1st 00:00 local, next 1st 00:00 local)`; the two ends can carry",
    "  different UTC offsets across a DST change.",
    "- **A day bucket is the local calendar day** of the instant, `yyyy-MM-dd`, and a",
    "  **month bucket is its first seven characters**, `yyyy-MM`. Months and days can",
    "  never disagree about which window a row belongs to: they read the same frozen day.",
    "- **An account bucket is the account the money left** (`fromAccountId`), except",
    "  for INCOME and for an increase-only ADJUSTMENT, which have no `fromAccountId`",
    "  and are keyed by the one they reached. A quick-add left the default account.",
    "- **`categoryIds` filters before anything else.** It is what a budget of several",
    "  categories sends, and it drops every row with no category — the quick-adds included.",
    "- **`splitBy` adds a second dimension inside each bucket** (`splits`), so per",
    "  category AND month is one request. Unlike tags, splits never overlap: every row is",
    "  in exactly one of them, so they add up to the bucket's own total. Only month and",
    "  account buckets can be split, and only inside a `[from, to)` window: both are",
    "  bounded, a day grouping is not.",
    "- **Deleted rows (`deletedAt`) are invisible** to every figure, balances included.",
    "  Archived rows (`archivedAt`) still count: archiving is not deleting.",
    "- **`ADJUSTMENT` never counts as spending** unless the query names that type; it",
    "  does move balances. `TRANSFER` moves two balances and is never spending.",
    "- **A query with `type: null` means everything but `ADJUSTMENT`** — income and",
    "  transfers included. It is the API's default, and it surprises people.",
    "- **Tag buckets unwind**: a row with two tags is counted in both, so the buckets",
    "  can add up to more than `total`. `total` is over the rows, never over the buckets.",
    "  A row with no tags lands in `untagged`, one with no category in `uncategorized`.",
    "- **`avg` is rounded in minor units**: `round(totalCents / count)`.",
    "- **Ordering**: day and month buckets by key ascending, everything else by total",
    "  descending with the key breaking a tie (binary, the way Mongo compares strings —",
    "  not `localeCompare`). Splits are ranked the same way. No two buckets in a fixture",
    "  share a total anyway, so nobody reading one has to think about it.",
    "- **Budget `spent`**: a budget with no categories is global and takes the whole",
    "  window's spend of its type, quick-adds included; one with categories sums only",
    "  those. Archived budgets produce no view at all.",
    "- **Balances** are `openingBalance` plus the effect of the live rows. The client",
    "  never writes a balance (invariant 2): it projects it and marks the projection.",
    "  This is the rule, not the client's recipe: on the device the shown balance is",
    "  the server's `balance` from the mirror plus the effect of the unsent outbox,",
    "  and the two agree whenever the outbox is empty.",
    "- **`pending.transactionIds` is a set.** No order is part of the contract.",
    "- **`lists` are the opposite: there the order IS the contract.** Each one is the",
    "  first page of `GET /transactions` under its `sort` and `order`, and two rows with",
    "  the same amount are separated by their id, in the direction the page runs. A",
    "  listing also has no opinion about spending: with no `type` it shows TRANSFER and",
    "  ADJUSTMENT too, unlike a spending query.",
    "",
    "## Shape of a file",
    "",
    "`user`, `accounts`, `categories`, `transactions` and `budgets` are the input, in",
    "the shape the mirror holds them — the same shape `GET /sync/changes` sends, so",
    "budgets are **as stored** (`amount`, `amountOverrides`, `periodType`, dates), with",
    "no `periodKey`, `spent` or `expired`. Every row also carries a `key`, which is a",
    "human handle, never an id. `expected` holds `balances`, `pending`, `spending`",
    "(one entry per query, with the query spelled out), `lists` (one ordered page per",
    "query) and `budgets` (the views as of `expected.budgets.reference`).",
    "",
    "## The fixtures",
    "",
  ];

  for (const f of fixtures) {
    lines.push(`### \`${f.id}.json\` — ${f.title}`, "");
    for (const pin of f.pins) lines.push(`- ${pin}`);
    lines.push(
      "",
      `${f.transactions.length} transactions · ${f.accounts.length} accounts · ` +
        `${f.categories.length} categories · ${f.budgets.length} budgets · ` +
        `${f.expected.spending.length} spending queries · ` +
        `${f.expected.lists.length} ordered list${f.expected.lists.length === 1 ? "" : "s"} · ` +
        `reference \`${f.expected.budgets.reference}\``,
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export interface BuiltFile {
  name: string;
  body: string;
}

/** Every file of the directory, in memory: what `--check` compares and the test asserts. */
export function buildFixtureFiles(): {
  fixtures: Fixture[];
  files: BuiltFile[];
} {
  const fixtures = SCENARIOS.map((s, i) => buildFixture(s, i + 1));
  const files: BuiltFile[] = fixtures.map((fixture) => ({
    name: `${fixture.id}.json`,
    body: `${JSON.stringify(fixture, null, 2)}\n`,
  }));
  files.push({
    name: "index.json",
    body: `${JSON.stringify(
      {
        generatedBy: GENERATED_BY,
        fixtures: fixtures.map((f) => ({
          id: f.id,
          file: `${f.id}.json`,
          title: f.title,
          timezone: f.user.timezone,
          currency: f.user.currency,
          minorUnits: f.user.minorUnits,
          transactions: f.transactions.length,
        })),
      },
      null,
      2,
    )}\n`,
  });
  files.push({ name: "README.md", body: readme(fixtures) });
  return { fixtures, files };
}

/** Names of the files that differ from, are missing in, or are extra in `dir`. */
export function driftAgainst(dir: string, files: BuiltFile[]): string[] {
  const drift: string[] = [];
  for (const file of files) {
    const path = join(dir, file.name);
    if (!existsSync(path)) drift.push(`${file.name} (missing)`);
    else if (readFileSync(path, "utf8") !== file.body) {
      drift.push(`${file.name} (differs)`);
    }
  }
  const built = new Set(files.map((f) => f.name));
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!built.has(name)) drift.push(`${name} (not generated)`);
    }
  }
  return drift;
}

async function main(): Promise<void> {
  const { fixtures, files } = buildFixtureFiles();

  if (process.argv.includes("--check")) {
    const drift = driftAgainst(OUT_DIR, files);
    if (drift.length > 0) {
      console.error(
        `fixtures/offline is out of date with scripts/offline-fixtures:\n  ${drift.join("\n  ")}\nRun npm run fixtures:offline and commit the result.`,
      );
      process.exit(1);
    }
    console.log(
      `fixtures/offline matches the generator (${files.length} files)`,
    );
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const file of files) {
    await writeFile(join(OUT_DIR, file.name), file.body, "utf8");
  }

  console.log(`Wrote ${fixtures.length} fixtures to ${OUT_DIR}`);
  for (const f of fixtures) {
    const month = f.expected.spending[0];
    console.log(
      `  ${f.id.padEnd(12)} ${String(f.transactions.length).padStart(2)} rows · ` +
        `${month?.name} total ${month?.total} ${f.user.currency} · ` +
        `${f.expected.budgets.views.length} budget views · ` +
        `${f.expected.pending.count} pending`,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
