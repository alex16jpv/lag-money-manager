/**
 * Deterministic seed for the frontend's end-to-end tests and screenshot diffs:
 * `npm run seed:test`.
 *
 * Builds one known user whose accounts, categories, transactions and budgets
 * reproduce the dataset the designs were drawn from (auditoria/diseno/). Every
 * run leaves the database in the same state.
 *
 * It writes through the application services rather than into Mongo directly,
 * so balances come out of the real transaction flow and every validation the
 * API enforces is enforced here too — a seed that bypassed them could describe
 * a state the API itself would refuse to produce. Afterwards it reads the data
 * back and asserts the balances and per-category totals, so a silent drift in
 * the dataset fails the run instead of reaching the frontend's fixtures.
 */
import "dotenv/config";

import { DateTime } from "luxon";
import mongoose from "mongoose";

import repositoryFactory from "../src/app/factories/RepositoryFactory";
import { AccountService } from "../src/app/services/AccountService";
import { AuthService } from "../src/app/services/AuthService";
import { BudgetService } from "../src/app/services/BudgetService";
import { CategoryService } from "../src/app/services/CategoryService";
import { StatsService } from "../src/app/services/StatsService";
import { TransactionService } from "../src/app/services/TransactionService";
import { connectMongo } from "../src/config/mongoConnection";
import { AccountModel } from "../src/infrastructure/models/AccountModel";
import { BudgetModel } from "../src/infrastructure/models/BudgetModel";
import { CategoryModel } from "../src/infrastructure/models/CategoryModel";
import { IdempotencyKeyModel } from "../src/infrastructure/models/IdempotencyKeyModel";
import { RefreshSessionModel } from "../src/infrastructure/models/RefreshSessionModel";
import { TransactionModel } from "../src/infrastructure/models/TransactionModel";
import { UserModel } from "../src/infrastructure/models/UserModel";
import { ENVIRONMENT } from "../src/shared/constants";
import { DEFAULT_CATEGORIES } from "../src/shared/defaultCategories";
import {
  ACCOUNTS,
  ARCHIVED_CATEGORY_KEY,
  BUDGET_IDS,
  DELETED_EXPENSES,
  DELETED_QUICK_ADD,
  EXTRA_CATEGORIES,
  NON_EXPENSE,
  PRIOR_MONTHS,
  QUICK_ADDS,
  REFERENCE_MONTH_EXPENSES,
  resolveReferenceDay,
  resolveReferenceMonth,
  SEED_USER,
  SEEDED_CATEGORY_IDS,
  SYNC_SPREAD,
  SyncSpread,
  UNCATEGORIZED_TOTAL,
} from "./seed-test.data";
import { writeSeedOutput } from "./seed-test.output";

/* eslint-disable no-console -- a CLI script reports to its operator, not to the app log */

interface PlannedTransaction {
  id: string;
  type: "EXPENSE" | "INCOME" | "TRANSFER" | "ADJUSTMENT";
  amount: number;
  date: Date;
  description?: string;
  categoryKey?: string;
  fromAccount?: string;
  toAccount?: string;
  tags?: string[];
  quick?: boolean;
  /** Created and then deleted, so the change feed has a tombstone to report. */
  deleted?: boolean;
}

/** Sequential, stable ids: the nth transaction always gets the nth id. */
const txId = (n: number): string =>
  `01920000-0000-7000-8000-${String(n).padStart(12, "0")}`;

/** Spreads n items evenly across the elapsed days of the month. */
const dayOf = (
  month: DateTime,
  index: number,
  count: number,
  lastDay: number,
): Date =>
  month
    .set({ day: Math.min(lastDay, 1 + Math.floor((index * lastDay) / count)) })
    .set({ hour: 12 })
    .toJSDate();

function planTransactions(
  month: DateTime,
  lastDay: number,
): PlannedTransaction[] {
  const planned: PlannedTransaction[] = [];
  const add = (t: Omit<PlannedTransaction, "id">): void => {
    planned.push({ ...t, id: txId(planned.length + 1) });
  };

  const groups = Object.entries(REFERENCE_MONTH_EXPENSES);
  const monthCount = groups.reduce((a, [, g]) => a + g.items.length, 0);
  let i = 0;
  for (const [categoryKey, group] of groups) {
    for (const item of group.items) {
      add({
        type: "EXPENSE",
        amount: item.amount,
        date: dayOf(month, i++, monthCount, lastDay),
        description: item.description,
        categoryKey,
        fromAccount: item.account,
        tags: [...item.tags],
      });
    }
  }

  // Salary lands on the first day; the transfer and the cash adjustment mid-month.
  add({
    type: "INCOME",
    amount: NON_EXPENSE.salary.amount,
    date: month.set({ day: 1, hour: 8 }).toJSDate(),
    description: NON_EXPENSE.salary.description,
    categoryKey: "salary",
    toAccount: NON_EXPENSE.salary.account,
  });
  add({
    type: "TRANSFER",
    amount: NON_EXPENSE.transfer.amount,
    date: month.set({ day: Math.min(5, lastDay), hour: 9 }).toJSDate(),
    description: "Monthly savings",
    fromAccount: NON_EXPENSE.transfer.from,
    toAccount: NON_EXPENSE.transfer.to,
  });
  add({
    type: "ADJUSTMENT",
    amount: NON_EXPENSE.adjustment.amount,
    date: month.set({ day: Math.min(10, lastDay), hour: 9 }).toJSDate(),
    description: "Cash count correction",
    toAccount: NON_EXPENSE.adjustment.account,
  });

  // Quick-adds stay uncategorised and pending review; the service routes them
  // to the default account on its own.
  QUICK_ADDS.forEach((amount, n) => {
    add({
      type: "EXPENSE",
      amount,
      date: month.set({ day: Math.max(1, lastDay - n), hour: 18 }).toJSDate(),
      quick: true,
    });
  });

  // Deleted afterwards. They belong to no design figure: every total the seed
  // asserts is computed over live rows, so these can carry any amount.
  for (const item of DELETED_EXPENSES) {
    add({
      type: "EXPENSE",
      amount: item.amount,
      date: month
        .set({ day: Math.min(item.dayOfMonth, lastDay), hour: 15 })
        .toJSDate(),
      description: item.description,
      categoryKey: item.categoryKey,
      fromAccount: item.account,
      deleted: true,
    });
  }
  add({
    type: "EXPENSE",
    amount: DELETED_QUICK_ADD.amount,
    date: month
      .set({ day: Math.min(DELETED_QUICK_ADD.dayOfMonth, lastDay), hour: 20 })
      .toJSDate(),
    quick: true,
    deleted: true,
  });

  for (const prior of PRIOR_MONTHS) {
    const priorMonth = month.minus({ months: prior.monthsAgo });
    const days = priorMonth.daysInMonth as number;
    prior.expenses.forEach((amount, n) => {
      add({
        type: "EXPENSE",
        amount,
        date: dayOf(priorMonth, n, prior.expenses.length, days),
        description: "Earlier month expense",
        categoryKey: "food",
        fromAccount: "bancolombia",
      });
    });
    add({
      type: "INCOME",
      amount: prior.income,
      date: priorMonth.set({ day: 1, hour: 8 }).toJSDate(),
      description: "Salary",
      categoryKey: "salary",
      toAccount: "bancolombia",
    });
  }

  return planned;
}

async function purge(userId: string, email: string): Promise<void> {
  // The only sanctioned hard delete in this codebase. This is a disposable
  // fixture user in a non-production database, and re-seeding on top of
  // soft-deleted rows would leave the unique indexes (email, account name,
  // budget period) held by documents nobody can see. Scoped to this id/email.
  await Promise.all([
    TransactionModel.deleteMany({ userId }),
    AccountModel.deleteMany({ userId }),
    CategoryModel.deleteMany({ userId }),
    BudgetModel.deleteMany({ userId }),
    RefreshSessionModel.deleteMany({ userId }),
    IdempotencyKeyModel.deleteMany({ _id: new RegExp(`^${userId}:`) }),
  ]);
  await UserModel.deleteMany({ $or: [{ _id: userId }, { email }] });
}

export async function seed(): Promise<Record<string, unknown>> {
  if (ENVIRONMENT.NODE_ENV === "production") {
    throw new Error(
      "seed:test refuses to run with NODE_ENV=production — it hard-deletes its fixture user",
    );
  }

  const referenceDay = resolveReferenceDay(process.env.SEED_TODAY);
  const { month, lastDay, shifted } = resolveReferenceMonth(referenceDay);

  const users = repositoryFactory.getUserRepository();
  const accounts = repositoryFactory.getAccountRepository();
  const transactions = repositoryFactory.getTransactionRepository();
  const categories = repositoryFactory.getCategoryRepository();

  const categoryService = new CategoryService(categories, transactions);
  const authService = new AuthService(
    users,
    categoryService,
    repositoryFactory.getRefreshSessionRepository(),
  );
  const accountService = new AccountService(accounts, users);
  const transactionService = new TransactionService(
    transactions,
    accounts,
    repositoryFactory.getIdempotencyRepository(),
    categories,
  );
  const budgetService = new BudgetService(
    repositoryFactory.getBudgetRepository(),
    transactions,
    categories,
    users,
  );
  const statsService = new StatsService(transactions);

  await purge(SEED_USER.id, SEED_USER.email);

  // The entities accept an explicit id and the services spread the DTO into
  // them, which is how the fixed ids survive; the DTO types do not declare
  // `id` because no API client may set one.
  await authService.register({
    id: SEED_USER.id,
    name: SEED_USER.name,
    email: SEED_USER.email,
    password: SEED_USER.password,
    timezone: SEED_USER.timezone,
    currency: SEED_USER.currency,
    locale: SEED_USER.locale,
  } as never);

  // Registration seeds the ten defaults with generated ids. They are dropped
  // and rebuilt with fixed ones — an id that changes on every run cannot anchor
  // a fixture — keeping each seedKey so restore-defaults still recognises them.
  await CategoryModel.deleteMany({ userId: SEED_USER.id });
  const idByKey = new Map<string, string>();
  for (const preset of DEFAULT_CATEGORIES) {
    const id = SEEDED_CATEGORY_IDS[preset.seedKey];
    if (!id)
      throw new Error(`No fixed id for seeded category ${preset.seedKey}`);
    await categoryService.createCategory({
      id,
      name: preset.name,
      icon: preset.icon,
      color: preset.color,
      type: preset.type,
      seedKey: preset.seedKey,
      userId: SEED_USER.id,
    } as never);
    idByKey.set(preset.seedKey, id);
  }

  for (const extra of EXTRA_CATEGORIES) {
    await categoryService.createCategory({
      id: extra.id,
      name: extra.name,
      icon: extra.icon,
      color: extra.color,
      type: extra.type,
      userId: SEED_USER.id,
    } as never);
    idByKey.set(extra.key, extra.id);
  }

  const categoryId = (key: string): string => {
    const id = idByKey.get(key);
    if (!id) throw new Error(`Seed references an unknown category: ${key}`);
    return id;
  };

  const planned = planTransactions(month, lastDay);

  // Opening balances are derived, never stated: whatever the transactions move,
  // the opening balance is the remainder that lands on the designed final one.
  const movement = new Map<string, number>();
  const shift = (key: string | undefined, delta: number): void => {
    if (key) movement.set(key, (movement.get(key) ?? 0) + delta);
  };
  for (const t of planned) {
    // Deleting reverses the effect, so a row that ends up deleted moves
    // nothing and must not shift the opening balance either.
    if (t.deleted) continue;
    // Quick-adds have no explicit account: the service charges the default one.
    shift(t.quick ? "bancolombia" : t.fromAccount, -t.amount);
    shift(t.toAccount, t.amount);
  }

  for (const account of ACCOUNTS) {
    await accountService.createAccount({
      id: account.id,
      name: account.name,
      type: account.type,
      color: account.color,
      balance: account.finalBalance - (movement.get(account.key) ?? 0),
      userId: SEED_USER.id,
    } as never);
  }

  const accountId = (key: string): string => {
    const found = ACCOUNTS.find((a) => a.key === key);
    if (!found) throw new Error(`Seed references an unknown account: ${key}`);
    return found.id;
  };

  for (const t of planned) {
    if (t.quick) {
      await transactionService.quickAddTransaction({
        id: t.id,
        amount: t.amount,
        date: t.date,
        userId: SEED_USER.id,
      } as never);
      continue;
    }
    await transactionService.createTransaction({
      id: t.id,
      type: t.type,
      amount: t.amount,
      date: t.date,
      description: t.description ?? null,
      categoryId: t.categoryKey ? categoryId(t.categoryKey) : null,
      fromAccountId: t.fromAccount ? accountId(t.fromAccount) : null,
      toAccountId: t.toAccount ? accountId(t.toAccount) : null,
      tags: t.tags ?? [],
      userId: SEED_USER.id,
    } as never);
  }

  // Deleted through the service, so the balances it moved are reversed and
  // the row keeps a real `deletedAt` — the only tombstone a transaction has.
  for (const t of planned) {
    if (t.deleted) {
      await transactionService.deleteTransaction(t.id, SEED_USER.id);
    }
  }

  const nequi = ACCOUNTS.find((a) => a.archived);
  if (nequi) await accountService.deleteAccount(nequi.id, SEED_USER.id);

  const ctx = {
    reference: month.set({ day: lastDay }).toJSDate(),
    timezone: SEED_USER.timezone,
  };
  // Budgets default their lifetime floor to createdAt — today — which hides
  // them when the client browses the month the seeded transactions live in.
  // Anchoring the floor before the oldest seeded month makes every
  // `?reference=` inside the dataset show real spend.
  const effectiveFrom = month
    .minus({ months: PRIOR_MONTHS.length })
    .startOf("month")
    .toJSDate();
  const prevMonth = month.minus({ months: 1 });
  const budgets = [
    {
      id: BUDGET_IDS.global,
      name: "Everything",
      color: "INDIGO",
      categoryIds: [],
      amount: 2_000_000,
      periodType: "MONTHLY",
      effectiveFrom,
    },
    {
      id: BUDGET_IDS.food,
      name: "Food",
      color: "ORANGE",
      categoryIds: [categoryId("food")],
      amount: 600_000,
      periodType: "MONTHLY",
      effectiveFrom,
    },
    {
      id: BUDGET_IDS.transportation,
      name: "Transport",
      color: "BLUE",
      categoryIds: [categoryId("transportation")],
      amount: 200_000,
      periodType: "MONTHLY",
      effectiveFrom,
    },
    {
      id: BUDGET_IDS.lifestyle,
      name: "Lifestyle",
      color: "PINK",
      categoryIds: [categoryId("lifestyle")],
      amount: 250_000,
      periodType: "MONTHLY",
      effectiveFrom,
      override: 300_000,
    },
    {
      id: BUDGET_IDS.coffee,
      name: "Coffee",
      color: "BROWN",
      categoryIds: [categoryId("coffee")],
      amount: 80_000,
      periodType: "WEEKLY",
      effectiveFrom,
    },
    {
      id: BUDGET_IDS.bills,
      name: "Bills",
      color: "AMBER",
      categoryIds: [categoryId("bills-services")],
      amount: 350_000,
      periodType: "BIWEEKLY",
      effectiveFrom,
    },
    {
      id: BUDGET_IDS.vacation,
      name: "Vacation",
      color: "CYAN",
      categoryIds: [categoryId("vacation")],
      amount: 2_500_000,
      periodType: "CUSTOM",
      periodStartDate: month.set({ day: Math.min(15, lastDay) }).toJSDate(),
      periodEndDate: month.plus({ months: 1 }).set({ day: 15 }).toJSDate(),
    },
    {
      id: BUDGET_IDS.expiredPrevMonth,
      name: "Last month's trip",
      color: "TEAL",
      categoryIds: [categoryId("lifestyle")],
      amount: 2_500_000,
      periodType: "CUSTOM",
      periodStartDate: prevMonth.startOf("month").toJSDate(),
      periodEndDate: prevMonth.endOf("month").startOf("day").toJSDate(),
    },
    {
      id: BUDGET_IDS.expiredDecember,
      name: "December gifts",
      color: "RED",
      categoryIds: [categoryId("housing")],
      amount: 500_000,
      periodType: "CUSTOM",
      periodStartDate: month
        .minus({ years: 1 })
        .set({ month: 12, day: 1 })
        .toJSDate(),
      periodEndDate: month
        .minus({ years: 1 })
        .set({ month: 12, day: 24 })
        .toJSDate(),
    },
    {
      id: BUDGET_IDS.archived,
      name: "Retired budget",
      color: "GRAY",
      categoryIds: [categoryId("health")],
      amount: 150_000,
      periodType: "MONTHLY",
      effectiveFrom,
      archived: true,
    },
  ] as const;

  for (const b of budgets) {
    await budgetService.createBudget(
      {
        id: b.id,
        name: b.name,
        color: b.color,
        categoryIds: b.categoryIds,
        amount: b.amount,
        periodType: b.periodType,
        periodStartDate: "periodStartDate" in b ? b.periodStartDate : null,
        periodEndDate: "periodEndDate" in b ? b.periodEndDate : null,
        effectiveFrom: "effectiveFrom" in b ? b.effectiveFrom : null,
        userId: SEED_USER.id,
      } as never,
      ctx,
    );
    if ("override" in b) {
      await budgetService.setAmountOverride(
        b.id,
        SEED_USER.id,
        b.override,
        ctx,
      );
    }
    if ("archived" in b) {
      await budgetService.deleteBudget(b.id, SEED_USER.id);
    }
  }

  // Archived only now: a budget may not be given an already-archived category,
  // so the seed reaches the designed state the way a user would — the budget
  // exists first, and archiving the category later is what fills its
  // `archivedCategoryIds`.
  await categoryService.deleteCategory(
    categoryId(ARCHIVED_CATEGORY_KEY),
    SEED_USER.id,
  );

  // register opens a session of its own (register is a login). Dropping it
  // leaves exactly the two devices the sessions screen is designed around.
  await RefreshSessionModel.deleteMany({ userId: SEED_USER.id });
  const sessions = repositoryFactory.getRefreshSessionRepository();
  for (const device of SEED_USER.devices) {
    await sessions.create({
      jti: device.jti,
      userId: SEED_USER.id,
      familyId: device.familyId,
      expiresAt: referenceDay.plus({ days: 30 }).toJSDate(),
      userAgent: device.userAgent,
    });
  }

  const sync = await spreadSyncTimestamps(referenceDay);

  await verify(accountService, statsService, month, lastDay, sync);

  return writeSeedOutput({
    referenceDay,
    month,
    lastDay,
    shifted,
    categoryId,
    accountId,
    transactionCount: planned.length,
    deletedTransactionCount: planned.filter((t) => t.deleted).length,
    sync,
  });
}

/** Collections in the change feed, and the field that marks a row as gone. */
const FEED_COLLECTIONS = [
  { name: "users", tombstone: "deletedAt", scoped: false },
  { name: "accounts", tombstone: "archivedAt", scoped: true },
  { name: "categories", tombstone: "archivedAt", scoped: true },
  { name: "budgets", tombstone: "archivedAt", scoped: true },
  { name: "transactions", tombstone: "deletedAt", scoped: true },
] as const;

/**
 * Spreads `createdAt`/`updatedAt` over a window that ends yesterday.
 *
 * Written through the driver, not through Mongoose: its timestamps stamp
 * "now" on every save, which is exactly the state this undoes. Everything the
 * seed just wrote shares one instant, and against that a `since` either
 * returns the whole database or nothing — so the incremental pull looks like
 * it works no matter what it does.
 *
 * Rows that were archived or deleted are stamped later than they were created,
 * because that is what happened to them; and a group of rows is put on one
 * exact instant so the `(updatedAt, _id)` tie-break has something to break.
 */
async function spreadSyncTimestamps(
  referenceDay: DateTime,
): Promise<SyncSpread> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle to spread the timestamps on");

  const rows: { collection: string; id: string; touched: boolean }[] = [];
  for (const collection of FEED_COLLECTIONS) {
    const docs = await db
      .collection(collection.name)
      .find(
        collection.scoped
          ? { userId: SEED_USER.id }
          : { _id: SEED_USER.id as never },
        { projection: { _id: 1, [collection.tombstone]: 1 } },
      )
      .sort({ _id: 1 })
      .toArray();
    for (const doc of docs) {
      rows.push({
        collection: collection.name,
        id: String(doc._id),
        touched: doc[collection.tombstone] != null,
      });
    }
  }

  const start = referenceDay.minus({ days: SYNC_SPREAD.startsDaysAgo });
  const end = referenceDay.minus({ days: SYNC_SPREAD.endsDaysAgo });
  const step = end.diff(start).milliseconds / Math.max(1, rows.length);
  const stamped = rows.map((row, i) => {
    const created = start.plus({ milliseconds: Math.round(i * step) });
    return {
      ...row,
      created,
      updated: row.touched
        ? created.plus({ hours: SYNC_SPREAD.touchedAfterHours })
        : created,
    };
  });

  // The shared instant is taken from untouched rows: an archived or deleted
  // one is stamped later than it was created, which would split the group.
  const group = stamped
    .filter((row) => !row.touched)
    .slice(-SYNC_SPREAD.sharedInstantRows);
  const sharedInstant = group[0]?.created ?? start;
  for (const row of group) {
    row.created = sharedInstant;
    row.updated = sharedInstant;
  }

  const writes = new Map<
    string,
    { id: string; created: Date; updated: Date }[]
  >();
  for (const row of stamped) {
    const batch = writes.get(row.collection) ?? [];
    batch.push({
      id: row.id,
      created: row.created.toJSDate(),
      updated: row.updated.toJSDate(),
    });
    writes.set(row.collection, batch);
  }

  for (const [collection, batch] of writes) {
    await db.collection(collection).bulkWrite(
      batch.map((row) => ({
        updateOne: {
          filter: { _id: row.id as never },
          update: { $set: { createdAt: row.created, updatedAt: row.updated } },
        },
      })),
    );
  }

  const tombstones = {
    accounts: 0,
    categories: 0,
    budgets: 0,
    transactions: 0,
  };
  for (const collection of FEED_COLLECTIONS) {
    if (!(collection.name in tombstones)) continue;
    tombstones[collection.name as keyof typeof tombstones] = await db
      .collection(collection.name)
      .countDocuments({
        userId: SEED_USER.id,
        [collection.tombstone]: { $ne: null },
      });
  }

  const updatedAt = stamped.map((row) => row.updated.toMillis());
  const inUserZone = (millis: number): string =>
    DateTime.fromMillis(millis).setZone(SEED_USER.timezone).toISO() as string;
  return {
    from: inUserZone(Math.min(...updatedAt)),
    to: inUserZone(Math.max(...updatedAt)),
    rows: rows.length,
    sharedInstant: sharedInstant.toISO() as string,
    sharedInstantRows: group.length,
    tombstones,
  };
}

/** Reads the data back and refuses to hand the frontend a drifted fixture. */
async function verify(
  accountService: AccountService,
  statsService: StatsService,
  month: DateTime,
  lastDay: number,
  sync: SyncSpread,
): Promise<void> {
  const failures: string[] = [];

  for (const account of ACCOUNTS) {
    const stored = await accountService.getAccountById(
      account.id,
      SEED_USER.id,
    );
    if (stored.balance !== account.finalBalance) {
      failures.push(
        `${account.name}: balance ${stored.balance}, expected ${account.finalBalance}`,
      );
    }
  }

  const stats = await statsService.getSpending(SEED_USER.id, {
    groupBy: "category",
    type: "EXPENSE",
    timezone: SEED_USER.timezone,
    from: month.startOf("month").toJSDate(),
    to: month.set({ day: lastDay }).endOf("day").toJSDate(),
  });
  const expected = Object.values(REFERENCE_MONTH_EXPENSES).reduce(
    (a, g) => a + g.total,
    UNCATEGORIZED_TOTAL,
  );
  if (stats.total !== expected) {
    failures.push(`month spending ${stats.total}, expected ${expected}`);
  }

  const sessionCount = await RefreshSessionModel.countDocuments({
    userId: SEED_USER.id,
  });
  if (sessionCount !== SEED_USER.devices.length) {
    failures.push(
      `${sessionCount} refresh sessions, expected ${SEED_USER.devices.length}`,
    );
  }

  failures.push(...(await syncFailures(sync)));

  if (failures.length > 0) {
    throw new Error(
      `Seed verification failed — the dataset and the API disagree:\n  ${failures.join("\n  ")}`,
    );
  }
  console.log(
    `Verified: ${ACCOUNTS.length} balances, the month total (${expected}) and ${sessionCount} sessions.`,
  );
  console.log(
    `Sync-ready: ${sync.rows} rows stamped from ${sync.from} to ${sync.to}, ` +
      `${sync.sharedInstantRows} sharing ${sync.sharedInstant}, tombstones ` +
      `${JSON.stringify(sync.tombstones)}.`,
  );
}

/**
 * The checks that make the seed usable by the change feed. Read back from the
 * database, not from the plan: what matters is what a `since` would actually
 * see.
 */
async function syncFailures(sync: SyncSpread): Promise<string[]> {
  const db = mongoose.connection.db;
  if (!db) return ["No database handle to verify the sync spread"];
  const failures: string[] = [];

  for (const [entity, count] of Object.entries(sync.tombstones)) {
    if (count < 1) {
      failures.push(
        `${entity}: no archived or deleted row for the change feed`,
      );
    }
  }

  const instants = new Set<number>();
  let inTheFuture = 0;
  const now = Date.now();
  for (const collection of FEED_COLLECTIONS) {
    const docs = await db
      .collection(collection.name)
      .find(
        collection.scoped
          ? { userId: SEED_USER.id }
          : { _id: SEED_USER.id as never },
        { projection: { updatedAt: 1 } },
      )
      .toArray();
    for (const doc of docs) {
      const at = (doc.updatedAt as Date).getTime();
      instants.add(at);
      if (at > now) inTheFuture += 1;
    }
  }

  if (instants.size < 2) {
    failures.push(
      `every row shares one updatedAt: a \`since\` cannot tell them apart`,
    );
  }
  if (inTheFuture > 0) {
    // The feed's cursor lands 60 s behind the server clock, so a row stamped
    // ahead of now would never come back through it.
    failures.push(`${inTheFuture} rows are stamped in the future`);
  }

  const total = await db
    .collection("transactions")
    .countDocuments({ userId: SEED_USER.id });
  const midpoint = new Date(
    (new Date(sync.from).getTime() + new Date(sync.to).getTime()) / 2,
  );
  const after = await db
    .collection("transactions")
    .countDocuments({ userId: SEED_USER.id, updatedAt: { $gt: midpoint } });
  if (after === 0 || after === total) {
    failures.push(
      `a since in the middle of the window returns ${after} of ${total} transactions: the spread is not a spread`,
    );
  }

  return failures;
}

async function main(): Promise<void> {
  await connectMongo();
  console.log(`Seeding ${mongoose.connection.name}`);
  const summary = await seed();
  console.log(summary);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
