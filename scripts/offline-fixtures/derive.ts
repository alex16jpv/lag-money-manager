/**
 * Reference derivation for the parity fixtures: the same figures the API
 * computes, worked out from the rows alone, with no database.
 *
 * It is written on purpose as a SECOND implementation of the rules, not as a
 * call into the app's code. The fixture is only worth something if two
 * independent readings of the rules agree on it: this one produces the
 * expected block, and `parityFixtures.mongo.test.ts` checks the real services
 * against it on a real mongod. `lib/local/derive` in the frontend (O-F3) will
 * be the third.
 *
 * Everything is added in minor units and converted once at the end: as a
 * running float sum, 1000 − 10.10 + 1500 − 7.77 − 100 − 3.45 is
 * 2378.6800000000003, not the 2378.68 the fixture expects.
 */
import { DateTime } from "luxon";

import {
  ExpectedBucket,
  ExpectedSplit,
  FixtureAccount,
  FixtureBudget,
  FixtureCategory,
  FixtureTransaction,
  GroupBy,
  PeriodType,
  SplitBy,
  TransactionType,
} from "./types";

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

const live = (t: FixtureTransaction): boolean => t.deletedAt === null;
const instant = (iso: string): number => new Date(iso).getTime();

const dayOf = (iso: string, timezone: string): string =>
  DateTime.fromJSDate(new Date(iso), { zone: timezone }).toFormat("yyyy-MM-dd");

/** The run of local days a half-open instant window covers (see `transactions.md`). */
const dayBounds = (
  from: string,
  to: string,
  timezone: string,
): { fromDay: string; toDay: string } => ({
  fromDay: dayOf(from, timezone),
  toDay: DateTime.fromMillis(instant(to) - 1, { zone: timezone }).toFormat(
    "yyyy-MM-dd",
  ),
});

const withinDays = (
  t: FixtureTransaction,
  bounds: { fromDay: string; toDay: string },
): boolean => t.dayKey >= bounds.fromDay && t.dayKey <= bounds.toDay;

export function deriveBalances(
  accounts: FixtureAccount[],
  transactions: FixtureTransaction[],
): { key: string; accountId: string; balance: number }[] {
  const cents = new Map<string, number>(
    accounts.map((a) => [a.id, toCents(a.openingBalance)]),
  );
  const move = (id: string | null, delta: number): void => {
    if (id === null) return;
    cents.set(id, (cents.get(id) ?? 0) + delta);
  };

  for (const t of transactions) {
    if (!live(t)) continue;
    const amount = toCents(t.amount);
    if (t.type === "EXPENSE") move(t.fromAccountId, -amount);
    if (t.type === "INCOME") move(t.toAccountId, amount);
    if (t.type === "TRANSFER" || t.type === "ADJUSTMENT") {
      move(t.fromAccountId, -amount);
      move(t.toAccountId, amount);
    }
  }

  return accounts.map((a) => ({
    key: a.key,
    accountId: a.id,
    balance: fromCents(cents.get(a.id) ?? 0),
  }));
}

export function derivePending(transactions: FixtureTransaction[]): {
  count: number;
  total: number;
  transactionIds: string[];
} {
  const pending = transactions
    .filter((t) => live(t) && t.pendingDetails)
    .sort((a, b) => instant(a.date) - instant(b.date));
  return {
    count: pending.length,
    total: fromCents(pending.reduce((acc, t) => acc + toCents(t.amount), 0)),
    transactionIds: pending.map((t) => t.id),
  };
}

interface SpendingWindow {
  groupBy: GroupBy;
  splitBy: SplitBy | null;
  /** null means "every category", which is what the API does without the filter. */
  categoryIds: string[] | null;
  /** null means "everything but ADJUSTMENT", which is what the API defaults to. */
  type: TransactionType | null;
  from: string;
  to: string;
  timezone: string;
}

/** Binary, like Mongo's default collation. `localeCompare` disagrees with it outside ASCII. */
const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const categoryKey = (t: FixtureTransaction): string =>
  t.categoryId ?? "uncategorized";

/** The account the money left, except for income; an increase-only ADJUSTMENT only has the other side. */
const accountKey = (t: FixtureTransaction): string =>
  (t.type === "INCOME" ? t.toAccountId : t.fromAccountId) ??
  t.toAccountId ??
  "unassigned";

/** Every key one row lands in. Only tags produce more than one. */
function bucketKeys(t: FixtureTransaction, groupBy: GroupBy): string[] {
  switch (groupBy) {
    case "day":
      return [t.dayKey];
    case "month":
      return [t.dayKey.slice(0, 7)];
    case "category":
      return [categoryKey(t)];
    case "account":
      return [accountKey(t)];
    case "tag":
      // One row per tag: a two-tag transaction counts twice across buckets and once in the total.
      return t.tags.length === 0 ? ["untagged"] : t.tags;
    default: {
      const unreached: never = groupBy;
      throw new Error(`No bucket key for ${String(unreached)}`);
    }
  }
}

interface Tally {
  cents: number;
  count: number;
  splits: Map<string, { cents: number; count: number }>;
}

export function deriveSpending(
  transactions: FixtureTransaction[],
  window: SpendingWindow,
): { total: number; buckets: ExpectedBucket[] } {
  // Matched against the frozen day: a change of zone must not move a past row into another window.
  const bounds = dayBounds(window.from, window.to, window.timezone);
  const matched = transactions.filter((t) => {
    if (!live(t)) return false;
    if (window.type ? t.type !== window.type : t.type === "ADJUSTMENT") {
      return false;
    }
    if (
      window.categoryIds?.length &&
      !window.categoryIds.includes(t.categoryId ?? "")
    ) {
      return false;
    }
    return withinDays(t, bounds);
  });

  const totals = new Map<string, Tally>();
  for (const t of matched) {
    const cents = toCents(t.amount);
    for (const key of bucketKeys(t, window.groupBy)) {
      const bucket = totals.get(key) ?? {
        cents: 0,
        count: 0,
        splits: new Map(),
      };
      bucket.cents += cents;
      bucket.count += 1;
      if (window.splitBy) {
        const split = bucket.splits.get(categoryKey(t)) ?? {
          cents: 0,
          count: 0,
        };
        split.cents += cents;
        split.count += 1;
        bucket.splits.set(categoryKey(t), split);
      }
      totals.set(key, bucket);
    }
  }

  // Rounded in minor units, exactly where the API rounds it.
  const asBucket = (
    key: string,
    b: { cents: number; count: number },
  ): ExpectedSplit => ({
    key,
    total: fromCents(b.cents),
    count: b.count,
    avg: fromCents(Math.round(b.cents / b.count)),
  });
  const byTotalThenKey = (a: ExpectedSplit, b: ExpectedSplit): number =>
    b.total - a.total || byKey(a.key, b.key);

  const buckets: ExpectedBucket[] = Array.from(totals.entries()).map(
    ([key, b]) => ({
      ...asBucket(key, b),
      ...(window.splitBy
        ? {
            splits: Array.from(b.splits.entries())
              .map(([splitKey, s]) => asBucket(splitKey, s))
              .sort(byTotalThenKey),
          }
        : {}),
    }),
  );
  buckets.sort((a, b) =>
    window.groupBy === "day" || window.groupBy === "month"
      ? byKey(a.key, b.key)
      : byTotalThenKey(a, b),
  );

  return {
    // The total is over the matched rows, not over the buckets.
    total: fromCents(matched.reduce((acc, t) => acc + toCents(t.amount), 0)),
    buckets,
  };
}

export interface ResolvedPeriod {
  from: Date;
  to: Date;
  key: string;
}

export function resolvePeriod(
  budget: Pick<
    FixtureBudget,
    "periodType" | "periodStartDate" | "periodEndDate"
  >,
  reference: Date,
  timezone: string,
): ResolvedPeriod {
  if (budget.periodType === "CUSTOM") {
    if (!budget.periodStartDate || !budget.periodEndDate) {
      throw new Error("A CUSTOM budget needs both of its dates");
    }
    const from = new Date(budget.periodStartDate);
    const to = new Date(budget.periodEndDate);
    // Epoch millis: the key is used as a Mongo $set path, so it holds no dots.
    return { from, to, key: `${from.getTime()}_${to.getTime()}` };
  }

  const ref = DateTime.fromJSDate(reference, { zone: timezone });

  if (budget.periodType === "BIWEEKLY") {
    // Anchored on a global grid: the same fortnight for every budget of every user.
    const anchor = DateTime.fromISO("2024-01-01T00:00:00", {
      zone: timezone,
    }).startOf("week");
    const weekStart = ref.startOf("week");
    const weeks = Math.floor(weekStart.diff(anchor, "weeks").weeks);
    const from = weekStart.minus({ weeks: ((weeks % 2) + 2) % 2 });
    return {
      from: from.toJSDate(),
      to: from.plus({ weeks: 2 }).toJSDate(),
      key: from.toFormat("kkkk-'BW'WW"),
    };
  }

  const unit = (
    {
      WEEKLY: "week",
      MONTHLY: "month",
      QUARTERLY: "quarter",
      YEARLY: "year",
    } as const
  )[budget.periodType as Exclude<PeriodType, "CUSTOM" | "BIWEEKLY">];

  const start = ref.startOf(unit);
  return {
    from: start.toJSDate(),
    to: start.plus({ [`${unit}s`]: 1 }).toJSDate(),
    key: periodKey(budget.periodType, start),
  };
}

function periodKey(type: PeriodType, start: DateTime): string {
  switch (type) {
    case "WEEKLY":
      return start.toFormat("kkkk-'W'WW");
    case "MONTHLY":
      return start.toFormat("yyyy-MM");
    case "QUARTERLY":
      return `${start.year}-Q${start.quarter}`;
    case "YEARLY":
      return start.toFormat("yyyy");
    default:
      throw new Error(`No period key format for ${type}`);
  }
}

export function deriveBudgetViews(
  budgets: FixtureBudget[],
  transactions: FixtureTransaction[],
  categories: FixtureCategory[],
  reference: Date,
  timezone: string,
): {
  key: string;
  id: string;
  periodKey: string;
  periodFrom: string;
  periodTo: string;
  baseAmount: number;
  amount: number;
  hasOverride: boolean;
  spent: number;
  expired: boolean;
  archivedCategoryIds: string[];
}[] {
  const archived = new Set(
    categories.filter((c) => c.archivedAt !== null).map((c) => c.id),
  );

  return budgets
    .filter((b) => b.archivedAt === null)
    .map((b) => {
      const period = resolvePeriod(b, reference, timezone);
      const bounds = dayBounds(
        period.from.toISOString(),
        period.to.toISOString(),
        timezone,
      );
      const inWindow = transactions.filter(
        (t) => live(t) && t.type === b.type && withinDays(t, bounds),
      );
      // A budget with no categories is global: the window's whole spend, uncategorized included.
      const spentCents = inWindow
        .filter(
          (t) =>
            b.categoryIds.length === 0 ||
            (t.categoryId !== null && b.categoryIds.includes(t.categoryId)),
        )
        .reduce((acc, t) => acc + toCents(t.amount), 0);
      const override = b.amountOverrides[period.key];

      return {
        key: b.key,
        id: b.id,
        periodKey: period.key,
        periodFrom: period.from.toISOString(),
        periodTo: period.to.toISOString(),
        baseAmount: b.amount,
        amount: override ?? b.amount,
        hasOverride: override !== undefined,
        spent: fromCents(spentCents),
        expired:
          b.periodType === "CUSTOM" &&
          b.periodEndDate !== null &&
          reference.getTime() >= new Date(b.periodEndDate).getTime(),
        archivedCategoryIds: b.categoryIds.filter((c) => archived.has(c)),
      };
    });
}
