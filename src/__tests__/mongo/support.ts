/**
 * Shared plumbing for the mongod-backed suite: the connection, the fixture
 * files, and the code that puts a fixture into the database.
 *
 * The fixtures are written into Mongo **through the application services**,
 * never with raw inserts. A parity test that inserted the rows itself would
 * only prove that the aggregations read what the test wrote; going through the
 * services also proves the state is one the API can actually produce — the
 * balances are moved by the real transaction flow, and every validation the
 * API enforces is enforced here.
 */
import { readFileSync } from "fs";
import mongoose from "mongoose";
import { join } from "path";

import repositoryFactory from "../../app/factories/RepositoryFactory";
import { AccountService } from "../../app/services/AccountService";
import { BudgetService } from "../../app/services/BudgetService";
import { CategoryService } from "../../app/services/CategoryService";
import { StatsService } from "../../app/services/StatsService";
import { TransactionService } from "../../app/services/TransactionService";
import { connectMongo } from "../../config/mongoConnection";
import { UserModel } from "../../infrastructure/models/UserModel";

export interface Fixture {
  id: string;
  title: string;
  user: { id: string; timezone: string; currency: string; minorUnits: number };
  accounts: {
    key: string;
    id: string;
    name: string;
    type: string;
    color?: string;
    openingBalance: number;
    isDefault: boolean;
    archivedAt: string | null;
  }[];
  categories: {
    key: string;
    id: string;
    name: string;
    type: "EXPENSE" | "INCOME";
    archivedAt: string | null;
  }[];
  transactions: {
    key: string;
    id: string;
    type: "EXPENSE" | "INCOME" | "TRANSFER" | "ADJUSTMENT";
    amount: number;
    date: string;
    description: string | null;
    categoryId: string | null;
    fromAccountId: string | null;
    toAccountId: string | null;
    tags: string[];
    source: "MANUAL" | "QUICK";
    pendingDetails: boolean;
    deletedAt: string | null;
  }[];
  budgets: {
    key: string;
    id: string;
    name: string;
    type: "EXPENSE" | "INCOME";
    categoryIds: string[];
    amount: number;
    amountOverrides: Record<string, number>;
    periodType: string;
    periodStartDate: string | null;
    periodEndDate: string | null;
    effectiveFrom: string | null;
    archivedAt: string | null;
  }[];
  expected: {
    balances: { key: string; accountId: string; balance: number }[];
    pending: { count: number; total: number; transactionIds: string[] };
    spending: {
      name: string;
      query: {
        groupBy: "day" | "category" | "tag";
        type: string | null;
        from: string;
        to: string;
        timezone: string;
      };
      total: number;
      buckets: { key: string; total: number; count: number; avg: number }[];
    }[];
    budgets: {
      reference: string;
      views: {
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
      }[];
    };
  };
}

const FIXTURE_DIR =
  process.env.OFFLINE_FIXTURES_DIR ??
  join(__dirname, "../../../../auditoria/offline-fixtures");

export function loadFixtures(): Fixture[] {
  const index = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "index.json"), "utf8"),
  ) as { fixtures: { file: string }[] };
  return index.fixtures.map(
    (entry) =>
      JSON.parse(
        readFileSync(join(FIXTURE_DIR, entry.file), "utf8"),
      ) as Fixture,
  );
}

export const fixtureDir = (): string => FIXTURE_DIR;

export function services(): {
  accounts: AccountService;
  categories: CategoryService;
  transactions: TransactionService;
  budgets: BudgetService;
  stats: StatsService;
} {
  const accountRepo = repositoryFactory.getAccountRepository();
  const categoryRepo = repositoryFactory.getCategoryRepository();
  const transactionRepo = repositoryFactory.getTransactionRepository();
  const userRepo = repositoryFactory.getUserRepository();
  return {
    accounts: new AccountService(accountRepo, userRepo),
    categories: new CategoryService(categoryRepo, transactionRepo),
    transactions: new TransactionService(
      transactionRepo,
      accountRepo,
      repositoryFactory.getIdempotencyRepository(),
      categoryRepo,
    ),
    budgets: new BudgetService(
      repositoryFactory.getBudgetRepository(),
      transactionRepo,
      categoryRepo,
      userRepo,
    ),
    stats: new StatsService(transactionRepo),
  };
}

export async function connect(): Promise<void> {
  await connectMongo();
}

/** Leaves nothing behind: this database exists only for the run. */
export async function dropDatabase(): Promise<void> {
  await mongoose.connection.dropDatabase();
}

export async function disconnect(): Promise<void> {
  await mongoose.disconnect();
}

export async function seedFixture(fixture: Fixture): Promise<void> {
  const { accounts, categories, transactions, budgets } = services();
  const userId = fixture.user.id;

  await UserModel.create({
    _id: userId,
    name: `Fixture ${fixture.id}`,
    email: `${fixture.id}@offline.fixture`,
    // No login happens in this suite; the hash is never verified.
    password: "not-a-real-hash",
    timezone: fixture.user.timezone,
    currency: fixture.user.currency,
    locale: "en",
  });

  // The first account created is the default one, so a fixture whose default
  // is not first would describe a state this seeding cannot reach.
  const defaultIndex = fixture.accounts.findIndex((a) => a.isDefault);
  if (defaultIndex > 0) {
    throw new Error(
      `${fixture.id}: the default account must be the first one listed`,
    );
  }
  for (const account of fixture.accounts) {
    await accounts.createAccount({
      id: account.id,
      name: account.name,
      type: account.type,
      color: account.color,
      balance: account.openingBalance,
      userId,
    } as never);
  }

  for (const category of fixture.categories) {
    await categories.createCategory({
      id: category.id,
      name: category.name,
      type: category.type,
      icon: "tag",
      color: "GRAY",
      userId,
    } as never);
  }

  for (const t of fixture.transactions) {
    if (t.source === "QUICK") {
      await transactions.quickAddTransaction({
        id: t.id,
        amount: t.amount,
        date: new Date(t.date),
        userId,
      } as never);
      continue;
    }
    await transactions.createTransaction({
      id: t.id,
      type: t.type,
      amount: t.amount,
      date: new Date(t.date),
      description: t.description,
      categoryId: t.categoryId,
      fromAccountId: t.fromAccountId,
      toAccountId: t.toAccountId,
      tags: t.tags,
      userId,
    } as never);
  }

  // Deleted before anything is archived: a row is deleted the way a user
  // deletes it, while its account and category are still active.
  for (const t of fixture.transactions) {
    if (t.deletedAt !== null) {
      await transactions.deleteTransaction(t.id, userId);
    }
  }

  const ctx = {
    reference: new Date(fixture.expected.budgets.reference),
    timezone: fixture.user.timezone,
  };
  for (const b of fixture.budgets) {
    await budgets.createBudget(
      {
        id: b.id,
        name: b.name,
        type: b.type,
        // Not part of the contract: the fixture is about money, not colour.
        color: "GRAY",
        categoryIds: b.categoryIds,
        amount: b.amount,
        periodType: b.periodType,
        periodStartDate: b.periodStartDate && new Date(b.periodStartDate),
        periodEndDate: b.periodEndDate && new Date(b.periodEndDate),
        effectiveFrom: b.effectiveFrom && new Date(b.effectiveFrom),
        userId,
      } as never,
      ctx,
    );
    for (const amount of Object.values(b.amountOverrides)) {
      await budgets.setAmountOverride(b.id, userId, amount, ctx);
    }
    if (b.archivedAt !== null) {
      await budgets.deleteBudget(b.id, userId, ctx);
    }
  }

  // Archived last: a budget cannot be given an already-archived category, so
  // the fixture reaches its state the way a user would.
  for (const category of fixture.categories) {
    if (category.archivedAt !== null) {
      await categories.deleteCategory(category.id, userId);
    }
  }
  for (const account of fixture.accounts) {
    if (account.archivedAt !== null) {
      await accounts.deleteAccount(account.id, userId);
    }
  }
}
