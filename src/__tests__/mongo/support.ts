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
import { sharedLedgerService } from "../../app/factories/sharedLedger";
import { AccountService } from "../../app/services/AccountService";
import { BudgetService } from "../../app/services/BudgetService";
import { CategoryService } from "../../app/services/CategoryService";
import { ContactService } from "../../app/services/ContactService";
import { SharedExpenseService } from "../../app/services/SharedExpenseService";
import { SharedGroupService } from "../../app/services/SharedGroupService";
import { SharedLedgerService } from "../../app/services/SharedLedgerService";
import { SharedSettlementService } from "../../app/services/SharedSettlementService";
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
  contacts: { key: string; id: string; name: string }[];
  sharedGroups: {
    key: string;
    id: string;
    name: string;
    participantContactIds: string[];
    defaultSplit: {
      mode: "EQUAL" | "PERCENT";
      shares: { contactId: string | null; percent: number }[];
    };
    writeOffs: { contactId: string | null; expenseId: string | null }[];
  }[];
  sharedExpenses: {
    key: string;
    id: string;
    groupId: string;
    transactionId: string | null;
    description: string | null;
    date: string;
    amount: number;
    paidByContactId: string | null;
    customSplit: boolean;
    split: {
      mode: "EQUAL" | "PERCENT" | "EXACT" | "FIXED_REST";
      guests: { count: number; name: string | null } | null;
      shares: {
        party: "USER" | "CONTACT" | "GUESTS";
        contactId: string | null;
        percent: number | null;
        fixedAmount: number | null;
        amount: number;
        collected: number;
      }[];
    };
  }[];
  settlements: {
    key: string;
    id: string;
    counterparty: {
      kind: "CONTACT" | "GUESTS";
      contactId: string | null;
      expenseId: string | null;
    };
    date: string;
    collected: number;
    paid: number;
    outsideApp: boolean;
  }[];
  expected: {
    balances: { key: string; accountId: string; balance: number }[];
    countsAsYours: { key: string; transactionId: string; amount: number }[];
    shared: {
      key: string;
      id: string;
      amount: number;
      yourShare: number;
      owedToYou: number;
      youOwe: number;
      collected: number;
      writtenOff: number;
      status: "OPEN" | "SETTLED";
      people: {
        key: string;
        contactId: string | null;
        expenseId: string | null;
        owesYou: number;
        youOwe: number;
        state: string;
      }[];
    }[];
    pending: { count: number; total: number; transactionIds: string[] };
    spending: {
      name: string;
      query: {
        groupBy: "day" | "month" | "category" | "account" | "tag";
        splitBy: "category" | null;
        categoryIds: string[] | null;
        type: string | null;
        from: string;
        to: string;
        timezone: string;
      };
      total: number;
      buckets: {
        key: string;
        total: number;
        count: number;
        avg: number;
        splits?: { key: string; total: number; count: number; avg: number }[];
      }[];
    }[];
    lists: {
      name: string;
      query: {
        sort: "date" | "amount";
        order: "asc" | "desc";
        categoryIds: string[] | null;
        type: string | null;
        from: string;
        to: string;
        timezone: string;
        limit: number;
      };
      transactionIds: string[];
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
  join(__dirname, "../../../fixtures/offline");

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

/** The shared layer of a fixture, through the same services its routes call. */
async function seedShared(fixture: Fixture): Promise<void> {
  const userId = fixture.user.id;
  const { contacts, sharedGroups, sharedExpenses, settlements } = shared();

  for (const contact of fixture.contacts ?? []) {
    await contacts.createContact({
      id: contact.id,
      name: contact.name,
      userId,
    } as never);
  }
  for (const group of fixture.sharedGroups ?? []) {
    await sharedGroups.createGroup({
      id: group.id,
      name: group.name,
      contactIds: group.participantContactIds,
      defaultSplit: group.defaultSplit,
      userId,
    } as never);
  }
  for (const expense of fixture.sharedExpenses ?? []) {
    const split = expense.customSplit
      ? {
          mode: expense.split.mode,
          guests: expense.split.guests,
          shares: expense.split.shares.map((share) => ({
            party: share.party,
            contactId: share.contactId,
            percent: share.percent,
            fixedAmount: share.fixedAmount,
          })),
        }
      : undefined;
    await sharedExpenses.createExpense({
      id: expense.id,
      groupId: expense.groupId,
      userId,
      ...(expense.transactionId
        ? { transactionId: expense.transactionId }
        : {
            description: expense.description,
            date: new Date(expense.date),
            amount: expense.amount,
            paidByContactId: expense.paidByContactId,
          }),
      split,
    } as never);
  }
  for (const one of fixture.settlements ?? []) {
    await settlements.createSettlement(
      {
        id: one.id,
        userId,
        contactId: one.counterparty.contactId ?? undefined,
        expenseId: one.counterparty.expenseId ?? undefined,
        date: new Date(one.date),
        collected: one.collected || undefined,
        paid: one.paid || undefined,
        outsideApp: one.outsideApp,
        accountId: one.outsideApp
          ? undefined
          : (fixture.accounts.find((a) => a.isDefault)?.id ?? undefined),
      } as never,
      fixture.user.timezone,
    );
  }
  // Last, so each one gives up on what was still open by then.
  for (const group of fixture.sharedGroups ?? []) {
    for (const writeOff of group.writeOffs) {
      await sharedGroups.writeOff(
        group.id,
        {
          contactId: writeOff.contactId ?? undefined,
          expenseId: writeOff.expenseId ?? undefined,
        },
        userId,
      );
    }
  }
}

export function shared(): {
  contacts: ContactService;
  sharedGroups: SharedGroupService;
  sharedExpenses: SharedExpenseService;
  settlements: SharedSettlementService;
} {
  const expenseRepo = repositoryFactory.getSharedExpenseRepository();
  const settlementRepo = repositoryFactory.getSharedSettlementRepository();
  const transactionRepo = repositoryFactory.getTransactionRepository();
  const groupRepo = repositoryFactory.getSharedGroupRepository();
  const contactRepo = repositoryFactory.getContactRepository();
  const userRepo = repositoryFactory.getUserRepository();
  const ledger = new SharedLedgerService(
    expenseRepo,
    settlementRepo,
    transactionRepo,
  );
  return {
    contacts: new ContactService(contactRepo),
    sharedGroups: new SharedGroupService(
      groupRepo,
      expenseRepo,
      contactRepo,
      userRepo,
      transactionRepo,
      ledger,
    ),
    sharedExpenses: new SharedExpenseService(
      expenseRepo,
      groupRepo,
      transactionRepo,
      ledger,
    ),
    settlements: new SharedSettlementService(
      settlementRepo,
      expenseRepo,
      contactRepo,
      userRepo,
      ledger,
      services().transactions,
    ),
  };
}

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
      sharedLedgerService,
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

/**
 * Leaves nothing behind: this database exists only for the run. The indexes
 * go with it — `connectMongo` built them once, before the drop — so they are
 * rebuilt here: without them a taken name or a second default account is
 * accepted, and a suite that checks 409 DUPLICATE sees `applied`.
 */
export async function dropDatabase(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.createIndexes()),
  );
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

  // The first account created is the default, so a fixture with another default is unreachable.
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
      await transactions.quickAddTransaction(
        {
          id: t.id,
          amount: t.amount,
          date: new Date(t.date),
          userId,
        } as never,
        fixture.user.timezone,
      );
      continue;
    }
    await transactions.createTransaction(
      {
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
      } as never,
      fixture.user.timezone,
    );
  }

  // Deleted while its account and category are still active, the way a user deletes a row.
  for (const t of fixture.transactions) {
    if (t.deletedAt !== null) {
      await transactions.deleteTransaction(t.id, userId);
    }
  }

  await seedShared(fixture);

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

  // Archived last: a budget cannot take an already-archived category.
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
