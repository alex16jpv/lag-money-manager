/**
 * Builds `auditoria/offline-fixtures/` from the scenarios: `npm run fixtures:offline`.
 *
 * The directory lives outside both repositories on purpose — it is the shared
 * contract, read by the backend's parity test and by the frontend's derive
 * tests (O-F3) — so it is fully regenerable from here. Nothing is hand-edited
 * there.
 *
 * The output is byte-stable: no timestamps, no ids that move between runs. A
 * rebuild that changes a file means a rule changed, and invariant 6 of the
 * offline contract says the fixture travels in that same commit.
 */
import "dotenv/config";

import { mkdir, writeFile } from "fs/promises";
import { DateTime } from "luxon";
import { join } from "path";

import {
  deriveBalances,
  deriveBudgetViews,
  derivePending,
  deriveSpending,
  resolvePeriod,
} from "./derive";
import { fixtureId, SCENARIOS } from "./scenarios";
import {
  ExpectedSpending,
  Fixture,
  FixtureAccount,
  FixtureBudget,
  FixtureCategory,
  FixtureTransaction,
  Scenario,
} from "./types";

/* eslint-disable no-console -- a CLI script reports to its operator */

const OUT_DIR =
  process.env.OFFLINE_FIXTURES_DIR ??
  join(__dirname, "../../../auditoria/offline-fixtures");

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
    // Archived rows carry a stamp: the mirror needs it to hide them, and the
    // sync feed is the only place it ever arrives.
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
        description: t.description ?? null,
        categoryId: t.quick === true ? null : categoryId(t.category),
        // A quick-add is charged to the default account by the server, not by
        // the client: the fixture spells out where it landed.
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
      // Overrides are keyed by the period they belong to, which is why the
      // key format is part of this contract and not an implementation detail.
      stored.amountOverrides[
        resolvePeriod(stored, reference, user.timezone).key
      ] = b.override;
    }
    return stored;
  });

  const spending: ExpectedSpending[] = scenario.spending.map((q) => {
    const query = {
      groupBy: q.groupBy,
      type: q.type ?? null,
      from: q.from,
      to: q.to,
      timezone: user.timezone,
    };
    const derived = deriveSpending(transactions, query);
    if (q.groupBy !== "day") {
      assertNoTies(scenario, q.name, derived.buckets);
    }
    return { name: q.name, query, ...derived, note: q.note };
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
 * Two buckets with the same total would make the fixture depend on how Mongo
 * breaks a tie, which is unspecified. Better to refuse the scenario than to
 * ship a figure that changes between runs.
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
    "holds a set of rows and the figures they must produce. The backend checks",
    "them against a real mongod in `src/__tests__/mongo/parityFixtures.mongo.test.ts`;",
    "the frontend feeds the same file to its pure derivations. When a figure here",
    "changes, both sides change with it — invariant 6 of `OFFLINE-SYNC-PLAN.md §10`.",
    "",
    "## The rules the figures follow",
    "",
    "- **Add in minor units.** Every amount is a decimal in the currency's own unit,",
    "  as the API prints it. Multiply by 100, round, add as integers, divide once at",
    "  the end. Adding `0.10 + 0.20 + 19.99 + 2.30` in floats gives `22.590000000000003`.",
    "- **Windows are half-open `[from, to)`** and built in the **user's timezone**. A",
    "  month is `[1st 00:00 local, next 1st 00:00 local)`; the two ends can carry",
    "  different UTC offsets across a DST change.",
    "- **A day bucket is the local calendar day** of the instant, `yyyy-MM-dd`.",
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
    "- **Ordering**: day buckets by key ascending, everything else by total descending.",
    "  No two buckets in a fixture share a total, so the order is never ambiguous.",
    "- **Budget `spent`**: a budget with no categories is global and takes the whole",
    "  window's spend of its type, quick-adds included; one with categories sums only",
    "  those. Archived budgets produce no view at all.",
    "- **Balances** are `openingBalance` plus the effect of the live rows. The client",
    "  never writes a balance (invariant 2): it projects it and marks the projection.",
    "",
    "## Shape of a file",
    "",
    "`user`, `accounts`, `categories`, `transactions` and `budgets` are the input, in",
    "the shape the mirror holds them — the same shape `GET /sync/changes` sends, so",
    "budgets are **as stored** (`amount`, `amountOverrides`, `periodType`, dates), with",
    "no `periodKey`, `spent` or `expired`. Every row also carries a `key`, which is a",
    "human handle, never an id. `expected` holds `balances`, `pending`, `spending`",
    "(one entry per query, with the query spelled out) and `budgets` (the views as of",
    "`expected.budgets.reference`).",
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
        `reference \`${f.expected.budgets.reference}\``,
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(): Promise<void> {
  const fixtures = SCENARIOS.map((s, i) => buildFixture(s, i + 1));
  await mkdir(OUT_DIR, { recursive: true });

  for (const fixture of fixtures) {
    await writeFile(
      join(OUT_DIR, `${fixture.id}.json`),
      `${JSON.stringify(fixture, null, 2)}\n`,
      "utf8",
    );
  }

  await writeFile(
    join(OUT_DIR, "index.json"),
    `${JSON.stringify(
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
    "utf8",
  );

  await writeFile(join(OUT_DIR, "README.md"), readme(fixtures), "utf8");

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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
