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
  ExpectedPerson,
  ExpectedSharedGroup,
  ExpectedSplit,
  FixtureAccount,
  FixtureBudget,
  FixtureCategory,
  FixtureSettlement,
  FixtureShare,
  FixtureSharedExpense,
  FixtureSharedGroup,
  FixtureTransaction,
  GroupBy,
  PartyKind,
  PeriodType,
  PersonState,
  SortField,
  SortOrder,
  SplitBy,
  SplitMode,
  TransactionType,
} from "./types";

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

const live = (t: FixtureTransaction): boolean => t.deletedAt === null;

/**
 * What Stats and the budgets measure: what left the account minus what came
 * back. A row written before the figure existed carries its whole amount.
 */
const yoursCents = (t: FixtureTransaction): number =>
  toCents(t.countsAsYours ?? t.amount);
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
  // A collection lands in an account and a refund leaves one: the fifth kind of movement.
  settlements: FixtureSettlement[] = [],
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

  // Everything a settle-up writes lands in the default account of the fixture.
  const settlementAccount = accounts.find((a) => a.isDefault)?.id ?? null;
  for (const one of settlements) {
    if (one.deletedAt !== null || one.outsideApp) continue;
    move(settlementAccount, toCents(one.collected) - toCents(one.paid));
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
    const cents = yoursCents(t);
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
    total: fromCents(matched.reduce((acc, t) => acc + yoursCents(t), 0)),
    buckets,
  };
}

interface ListWindow {
  sort: SortField;
  order: SortOrder;
  categoryIds: string[] | null;
  /** null means every type, ADJUSTMENT included: a listing is not a spending query. */
  type: TransactionType | null;
  from: string;
  to: string;
  timezone: string;
  limit: number;
}

/**
 * The first page of `GET /transactions`, in order. Two rows with the same
 * amount are separated by their id, in the direction the page runs: without
 * that the order would depend on which one the index happened to reach first.
 */
export function deriveList(
  transactions: FixtureTransaction[],
  window: ListWindow,
): string[] {
  const bounds = dayBounds(window.from, window.to, window.timezone);
  const direction = window.order === "asc" ? 1 : -1;
  return transactions
    .filter((t) => {
      if (!live(t)) return false;
      if (window.type && t.type !== window.type) return false;
      if (
        window.categoryIds?.length &&
        !window.categoryIds.includes(t.categoryId ?? "")
      ) {
        return false;
      }
      return withinDays(t, bounds);
    })
    .sort((a, b) => {
      const rank =
        window.sort === "amount"
          ? toCents(a.amount) - toCents(b.amount)
          : instant(a.date) - instant(b.date);
      return direction * (rank || byKey(a.id, b.id));
    })
    .slice(0, window.limit)
    .map((t) => t.id);
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
        .reduce((acc, t) => acc + yoursCents(t), 0);
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

/* ---------- the shared layer ---------- */

/**
 * `floor(total × part ÷ whole)`, split so no product can pass 2^53. Written
 * again here, from the rule and not from the app's code: if the two ever
 * disagree, the fixture is what says so.
 */
const partOf = (total: number, part: number, whole: number): number =>
  Math.floor(total / whole) * part +
  Math.floor(((total % whole) * part) / whole);

export interface DerivedShare {
  party: PartyKind;
  contactId: string | null;
  percent: number | null;
  fixedAmount: number | null;
  /** Minor units. */
  amount: number;
  collected: number;
}

interface ShareInput {
  party: PartyKind;
  contactId: string | null;
  percent?: number;
  fixedAmount?: number;
  units: number;
}

/** The shares of one expense, adding up to it exactly, with the odd unit on whoever fronted it. */
export function resolveSharesMinor(
  totalMinor: number,
  mode: SplitMode,
  rows: ShareInput[],
  payerIndex: number,
  scale: number,
): number[] {
  const units = rows.reduce((sum, row) => sum + row.units, 0);
  const amounts = rows.map((row) => {
    if (mode === "EQUAL") return partOf(totalMinor, row.units, units);
    if (mode === "PERCENT") {
      const basisPoints = Math.round((row.percent ?? 0) * 100);
      return partOf(totalMinor, basisPoints, 10_000);
    }
    return Math.round((row.fixedAmount ?? 0) * scale);
  });
  if (mode === "FIXED_REST") {
    const pinnedTotal = rows.reduce(
      (sum, row, i) =>
        sum + (row.fixedAmount === undefined ? 0 : (amounts[i] ?? 0)),
      0,
    );
    const restUnits = rows.reduce(
      (sum, row) => sum + (row.fixedAmount === undefined ? row.units : 0),
      0,
    );
    const rest = totalMinor - pinnedTotal;
    rows.forEach((row, i) => {
      if (row.fixedAmount === undefined) {
        amounts[i] = partOf(rest, row.units, restUnits);
      }
    });
  }
  const assigned = amounts.reduce((sum, one) => sum + one, 0);
  amounts[payerIndex] = (amounts[payerIndex] ?? 0) + (totalMinor - assigned);
  return amounts;
}

interface OwedLine {
  key: string;
  date: string;
  owed: number;
}

/** Oldest line first, ties broken by id, so two devices reach the same answer. */
export function imputeMinor(
  lines: OwedLine[],
  pool: number,
): { settled: Map<string, number>; surplus: number } {
  let left = Math.max(0, pool);
  const settled = new Map<string, number>();
  const ordered = [...lines].sort(
    (a, b) =>
      instant(a.date) - instant(b.date) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  for (const line of ordered) {
    const covered = Math.min(Math.max(0, line.owed), left);
    settled.set(line.key, covered);
    left -= covered;
  }
  return { settled, surplus: left };
}

const keyOfParty = (party: {
  contactId: string | null;
  expenseId: string | null;
}): string =>
  party.expenseId ? `guests:${party.expenseId}` : `contact:${party.contactId}`;

export interface SharedInput {
  transactions: FixtureTransaction[];
  groups: FixtureSharedGroup[];
  expenses: FixtureSharedExpense[];
  settlements: FixtureSettlement[];
}

export interface DerivedShared {
  expenses: FixtureSharedExpense[];
  groups: FixtureSharedGroup[];
  countsAsYours: { key: string; transactionId: string; amount: number }[];
  shared: ExpectedSharedGroup[];
}

/**
 * The whole shared layer worked out from the rows: what each payment covers,
 * what that leaves as yours, what a write-off gives up on, and where every
 * group stands. Second reading of the rules, like everything else here.
 */
export function deriveShared(input: SharedInput): DerivedShared {
  const live = input.expenses.filter((e) => e.deletedAt === null);
  const paid = input.settlements.filter((s) => s.deletedAt === null);
  const collected = new Map<string, number>();

  const parties = new Set<string>();
  for (const expense of live) {
    for (const share of expense.split.shares) {
      if (share.party === "CONTACT" && share.contactId) {
        parties.add(`contact:${share.contactId}`);
      }
      if (share.party === "GUESTS") parties.add(`guests:${expense.id}`);
    }
  }

  for (const party of parties) {
    const [kind, id] = party.split(":");
    const theirs = (expense: FixtureSharedExpense): FixtureShare | undefined =>
      expense.split.shares.find((share) =>
        kind === "guests"
          ? share.party === "GUESTS" && expense.id === id
          : share.party === "CONTACT" && share.contactId === id,
      );
    const yours = (expense: FixtureSharedExpense): FixtureShare | undefined =>
      expense.split.shares.find((share) => share.party === "USER");

    const theyOweLines: OwedLine[] = [];
    const youOweLines: OwedLine[] = [];
    for (const expense of live) {
      const share = theirs(expense);
      if (expense.paidByContactId === null && share) {
        theyOweLines.push({
          key: expense.id,
          date: expense.date,
          owed: toCents(share.amount),
        });
      }
      const mine = yours(expense);
      if (kind === "contact" && expense.paidByContactId === id && mine) {
        youOweLines.push({
          key: expense.id,
          date: expense.date,
          owed: toCents(mine.amount),
        });
      }
    }

    const withThem = paid.filter((s) => keyOfParty(s.counterparty) === party);
    const pools = {
      theyOwe: withThem.reduce((sum, s) => sum + toCents(s.collected), 0),
      youOwe: withThem.reduce((sum, s) => sum + toCents(s.paid), 0),
    };
    // What you handed over covers your own lines first; the rest is their money going back.
    const mine = imputeMinor(youOweLines, pools.youOwe);
    const theirsImputed = imputeMinor(
      theyOweLines,
      pools.theyOwe - mine.surplus,
    );
    for (const [expenseId, amount] of theirsImputed.settled) {
      collected.set(`${party}|${expenseId}`, amount);
    }
    for (const [expenseId, amount] of mine.settled) {
      collected.set(`user|${expenseId}|${party}`, amount);
    }
  }

  const expenses = input.expenses.map((expense) => ({
    ...expense,
    split: {
      ...expense.split,
      shares: expense.split.shares.map((share) => {
        const party =
          share.party === "GUESTS"
            ? `guests:${expense.id}`
            : `contact:${share.contactId}`;
        if (share.party === "USER") {
          const owner = expense.paidByContactId
            ? `contact:${expense.paidByContactId}`
            : null;
          const settled = owner
            ? (collected.get(`user|${expense.id}|${owner}`) ?? 0)
            : 0;
          return { ...share, collected: fromCents(settled) };
        }
        return {
          ...share,
          collected: fromCents(collected.get(`${party}|${expense.id}`) ?? 0),
        };
      }),
    },
  }));

  const openOf = (groupId: string, party: string): number =>
    expenses
      .filter(
        (e) =>
          e.groupId === groupId &&
          e.deletedAt === null &&
          e.paidByContactId === null,
      )
      .reduce((sum, expense) => {
        const share = expense.split.shares.find(
          (one) =>
            (one.party === "GUESTS" && party === `guests:${expense.id}`) ||
            (one.party === "CONTACT" && party === `contact:${one.contactId}`),
        );
        if (!share) return sum;
        return (
          sum + Math.max(0, toCents(share.amount) - toCents(share.collected))
        );
      }, 0);

  // Decided after every payment above, which is the order the rows are written in.
  const groups = input.groups.map((group) => ({
    ...group,
    writeOffs: group.writeOffs.map((one) => ({
      ...one,
      amount: fromCents(openOf(group.id, keyOfParty(one))),
    })),
  }));

  const countsAsYours = input.transactions
    .filter((t) => t.deletedAt === null)
    .map((t) => {
      const expense = expenses.find(
        (e) => e.transactionId === t.id && e.deletedAt === null,
      );
      const cameBack = expense
        ? expense.split.shares
            .filter((share) => share.party !== "USER")
            .reduce((sum, share) => sum + toCents(share.collected), 0)
        : 0;
      return {
        key: t.key,
        transactionId: t.id,
        amount: fromCents(toCents(t.amount) - cameBack),
      };
    });

  const shared = groups.map((group) => {
    const rows = expenses.filter(
      (e) => e.groupId === group.id && e.deletedAt === null,
    );
    const given = new Map(
      group.writeOffs.map((one) => [keyOfParty(one), toCents(one.amount)]),
    );
    const people = new Map<string, ExpectedPerson>();
    let amount = 0;
    let yourShare = 0;
    let owedGross = 0;
    let youOwe = 0;
    let collectedTotal = 0;

    for (const expense of rows) {
      amount += toCents(expense.amount);
      for (const share of expense.split.shares) {
        const open = Math.max(
          0,
          toCents(share.amount) - toCents(share.collected),
        );
        if (share.party === "USER") {
          yourShare += toCents(share.amount);
          if (expense.paidByContactId !== null) {
            youOwe += open;
            const key = `contact:${expense.paidByContactId}`;
            const row = people.get(key) ?? {
              key,
              contactId: expense.paidByContactId,
              expenseId: null,
              owesYou: 0,
              youOwe: 0,
              state: "NOT_PAID" as PersonState,
            };
            row.youOwe += open;
            people.set(key, row);
          }
          continue;
        }
        if (expense.paidByContactId !== null) continue;
        const key =
          share.party === "GUESTS"
            ? `guests:${expense.id}`
            : `contact:${share.contactId}`;
        owedGross += open;
        collectedTotal += toCents(share.collected);
        const row = people.get(key) ?? {
          key,
          contactId: share.party === "GUESTS" ? null : share.contactId,
          expenseId: share.party === "GUESTS" ? expense.id : null,
          owesYou: 0,
          youOwe: 0,
          state: "NOT_PAID" as PersonState,
        };
        row.owesYou += open;
        people.set(key, row);
      }
    }

    let writtenOff = 0;
    for (const [key, row] of people) {
      const ceiling = given.get(key);
      if (ceiling !== undefined) {
        const forgiven = Math.min(ceiling, row.owesYou);
        writtenOff += forgiven;
        row.owesYou -= forgiven;
        row.state = "WRITTEN_OFF";
        continue;
      }
      const settled = rows
        .filter((e) => e.paidByContactId === null)
        .reduce((sum, expense) => {
          const share = expense.split.shares.find(
            (one) =>
              (one.party === "GUESTS" && key === `guests:${expense.id}`) ||
              (one.party === "CONTACT" && key === `contact:${one.contactId}`),
          );
          return sum + (share ? toCents(share.collected) : 0);
        }, 0);
      row.state =
        row.owesYou === 0
          ? "PAID"
          : settled > 0
            ? "PARTIALLY_PAID"
            : "NOT_PAID";
    }

    const owedToYou = owedGross - writtenOff;
    return {
      key: group.key,
      id: group.id,
      amount: fromCents(amount),
      yourShare: fromCents(yourShare),
      owedToYou: fromCents(owedToYou),
      youOwe: fromCents(youOwe),
      collected: fromCents(collectedTotal),
      writtenOff: fromCents(writtenOff),
      status: owedToYou === 0 && youOwe === 0 ? "SETTLED" : "OPEN",
      people: [...people.values()]
        .map((row) => ({
          ...row,
          owesYou: fromCents(row.owesYou),
          youOwe: fromCents(row.youOwe),
        }))
        .sort((a, b) => (a.key < b.key ? -1 : 1)),
    } as ExpectedSharedGroup;
  });

  return { expenses, groups, countsAsYours, shared };
}
