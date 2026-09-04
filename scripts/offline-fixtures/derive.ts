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
 * Everything is added in minor units and converted once at the end. Adding
 * 0.10 + 0.20 + 19.99 + 2.30 in floats gives 22.590000000000003.
 */
import { DateTime } from "luxon";

import {
  ExpectedBucket,
  FixtureAccount,
  FixtureBudget,
  FixtureCategory,
  FixtureTransaction,
  GroupBy,
  PeriodType,
  TransactionType,
} from "./types";

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

const live = (t: FixtureTransaction): boolean => t.deletedAt === null;
const instant = (iso: string): number => new Date(iso).getTime();

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
  /** null means "everything but ADJUSTMENT", which is what the API defaults to. */
  type: TransactionType | null;
  from: string;
  to: string;
  timezone: string;
}

export function deriveSpending(
  transactions: FixtureTransaction[],
  window: SpendingWindow,
): { total: number; buckets: ExpectedBucket[] } {
  const from = instant(window.from);
  const to = instant(window.to);
  const matched = transactions.filter((t) => {
    if (!live(t)) return false;
    if (window.type ? t.type !== window.type : t.type === "ADJUSTMENT") {
      return false;
    }
    const at = instant(t.date);
    // Half-open [from, to): a transaction at the closing instant belongs to
    // the next window, never to two.
    return at >= from && at < to;
  });

  const totals = new Map<string, { cents: number; count: number }>();
  const add = (key: string, cents: number): void => {
    const bucket = totals.get(key) ?? { cents: 0, count: 0 };
    bucket.cents += cents;
    bucket.count += 1;
    totals.set(key, bucket);
  };

  for (const t of matched) {
    const cents = toCents(t.amount);
    if (window.groupBy === "day") {
      add(
        DateTime.fromJSDate(new Date(t.date), {
          zone: window.timezone,
        }).toFormat("yyyy-MM-dd"),
        cents,
      );
    } else if (window.groupBy === "category") {
      add(t.categoryId ?? "uncategorized", cents);
    } else if (t.tags.length === 0) {
      add("untagged", cents);
    } else {
      // One row per tag: a two-tag transaction is counted twice across the
      // buckets and once in the total. The API unwinds the same way.
      for (const tag of t.tags) add(tag, cents);
    }
  }

  const buckets = Array.from(totals.entries()).map(([key, b]) => ({
    key,
    total: fromCents(b.cents),
    count: b.count,
    // Rounded in minor units, exactly where the API rounds it.
    avg: fromCents(Math.round(b.cents / b.count)),
  }));
  buckets.sort((a, b) =>
    window.groupBy === "day"
      ? a.key.localeCompare(b.key)
      : b.total - a.total || a.key.localeCompare(b.key),
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
    // Anchored on a global grid, not on the budget: the same fortnight for
    // every budget of every user.
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
      const from = period.from.getTime();
      const to = period.to.getTime();
      const inWindow = transactions.filter((t) => {
        if (!live(t) || t.type !== b.type) return false;
        const at = instant(t.date);
        return at >= from && at < to;
      });
      // A budget with no categories is global: the window's whole spend,
      // uncategorized rows included. A per-category one sums only its own.
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
