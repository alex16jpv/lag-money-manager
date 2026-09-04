import { SyncService } from "../../app/services/SyncService";
import { Account } from "../../domain/entities/Account";
import { Budget } from "../../domain/entities/Budget";
import { Category } from "../../domain/entities/Category";
import { Transaction } from "../../domain/entities/Transaction";
import { User } from "../../domain/entities/User";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IBudgetRepository } from "../../domain/repositories/budget/IBudgetRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import {
  ChangedTransaction,
  ITransactionRepository,
} from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { decodeCursor, SYNC_OVERLAP_MS } from "../../shared/syncCursor";

const USER_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const at = (iso: string): Date => new Date(iso);

const user = new User({
  id: USER_ID,
  name: "John Doe",
  email: "john@example.com",
  password: "hashed",
  createdAt: at("2026-01-01T00:00:00.000Z"),
  updatedAt: at("2026-01-01T00:00:00.000Z"),
});

const account = (
  id: string,
  updatedAt: string,
  archivedAt: Date | null = null,
): Account =>
  new Account({
    id,
    name: `Account ${id}`,
    type: "CASH",
    balance: 10,
    userId: USER_ID,
    archivedAt,
    createdAt: at(updatedAt),
    updatedAt: at(updatedAt),
  });

const category = (id: string, updatedAt: string): Category =>
  new Category({
    id,
    name: `Category ${id}`,
    userId: USER_ID,
    createdAt: at(updatedAt),
    updatedAt: at(updatedAt),
  });

const budget = (id: string, updatedAt: string): Budget =>
  new Budget({
    id,
    name: `Budget ${id}`,
    color: "TEAL",
    categoryIds: [],
    amount: 100,
    periodType: "MONTHLY",
    userId: USER_ID,
    createdAt: at(updatedAt),
    updatedAt: at(updatedAt),
  });

const transaction = (
  id: string,
  updatedAt: string,
  deletedAt: Date | null = null,
): ChangedTransaction =>
  Object.assign(
    new Transaction({
      id,
      type: "EXPENSE",
      amount: 5,
      date: at("2026-01-01T00:00:00.000Z"),
      fromAccountId: "acc",
      userId: USER_ID,
      createdAt: at(updatedAt),
      updatedAt: at(updatedAt),
    }),
    { deletedAt },
  );

interface Feed {
  changesSince: jest.Mock;
}

interface Harness {
  service: SyncService;
  users: { getById: jest.Mock };
  accounts: Feed;
  categories: Feed;
  transactions: Feed;
  budgets: Feed;
}

// The profile is absent by default: it shares the page with everything else,
// and a row that is always there would hide the boundary the merge is about.
const build = (): Harness => {
  const users = { getById: jest.fn().mockResolvedValue(null) };
  const feed = (): Feed => ({ changesSince: jest.fn().mockResolvedValue([]) });
  const accounts = feed();
  const categories = feed();
  const transactions = feed();
  const budgets = feed();
  const service = new SyncService(
    users as unknown as IUserRepository,
    accounts as unknown as IAccountRepository,
    categories as unknown as ICategoryRepository,
    transactions as unknown as ITransactionRepository,
    budgets as unknown as IBudgetRepository,
  );
  return { service, users, accounts, categories, transactions, budgets };
};

describe("SyncService.getChanges", () => {
  it("asks every source for one row past the page, so hasMore needs no second query", async () => {
    const { service, accounts, categories, transactions, budgets } = build();

    await service.getChanges(USER_ID, undefined, 50);

    for (const repo of [accounts, categories, transactions, budgets]) {
      expect(repo.changesSince).toHaveBeenCalledWith(USER_ID, undefined, 51);
    }
  });

  it("passes the cursor down untouched: the snapshot is the same code path", async () => {
    const { service, accounts } = build();
    const cursor = { updatedAt: at("2026-05-01T00:00:00.000Z"), id: "x" };

    await service.getChanges(USER_ID, cursor, 10);

    expect(accounts.changesSince).toHaveBeenCalledWith(USER_ID, cursor, 11);
  });

  // The merge is what makes the page a global window over the four
  // collections; per-entity limits would let one busy entity starve the rest.
  it("cuts the page at the global (updatedAt, _id) boundary, not per entity", async () => {
    const { service, accounts, transactions } = build();
    accounts.changesSince.mockResolvedValue([
      account("a1", "2026-01-01T00:00:00.000Z"),
      account("a2", "2026-01-03T00:00:00.000Z"),
    ]);
    transactions.changesSince.mockResolvedValue([
      transaction("t1", "2026-01-02T00:00:00.000Z"),
      transaction("t2", "2026-01-04T00:00:00.000Z"),
    ]);

    const page = await service.getChanges(USER_ID, undefined, 2);

    expect(page.changes.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect(page.changes.transactions.map((t) => t.id)).toEqual(["t1"]);
    expect(page.pagination).toMatchObject({ count: 2, hasMore: true });
  });

  it("resumes exactly where it stopped: nextCursor is the last row emitted", async () => {
    const { service, accounts } = build();
    accounts.changesSince.mockResolvedValue([
      account("a1", "2026-01-01T00:00:00.000Z"),
      account("a2", "2026-01-02T00:00:00.000Z"),
    ]);

    const page = await service.getChanges(USER_ID, undefined, 1);

    expect(page.pagination.hasMore).toBe(true);
    expect(decodeCursor(page.pagination.nextCursor)).toEqual({
      updatedAt: at("2026-01-01T00:00:00.000Z"),
      id: "a1",
    });
  });

  // A row updated between two pages moves forward in the ordering, never back,
  // so the tie-break has to be the id or the second page skips a row.
  it("splits an instant shared by several rows without losing any", async () => {
    const { service, accounts } = build();
    const same = "2026-01-01T00:00:00.000Z";
    accounts.changesSince.mockResolvedValue([
      account("a1", same),
      account("a2", same),
      account("a3", same),
    ]);

    const first = await service.getChanges(USER_ID, undefined, 2);
    expect(first.changes.accounts.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(decodeCursor(first.pagination.nextCursor)).toEqual({
      updatedAt: at(same),
      id: "a2",
    });
  });

  it("hands back a watermark 60 s behind serverTime once the run is done", async () => {
    const { service, accounts } = build();
    accounts.changesSince.mockResolvedValue([
      account("a1", "2026-01-01T00:00:00.000Z"),
    ]);

    const page = await service.getChanges(USER_ID, undefined, 50);

    expect(page.pagination.hasMore).toBe(false);
    const next = decodeCursor(page.pagination.nextCursor);
    expect(next.id).toBeNull();
    expect(next.updatedAt.getTime()).toBe(
      page.serverTime.getTime() - SYNC_OVERLAP_MS,
    );
  });

  it("still hands back a watermark when nothing changed", async () => {
    const { service } = build();

    const page = await service.getChanges(USER_ID, undefined, 50);

    expect(page.pagination).toMatchObject({ count: 0, hasMore: false });
    expect(page.changes).toEqual({
      user: null,
      accounts: [],
      categories: [],
      transactions: [],
      budgets: [],
    });
    expect(decodeCursor(page.pagination.nextCursor).id).toBeNull();
  });

  // Invariant 4 of the offline contract: without these the client would keep
  // showing rows the server no longer has.
  it("reports archived and deleted rows, not just live ones", async () => {
    const { service, accounts, transactions } = build();
    accounts.changesSince.mockResolvedValue([
      account("a1", "2026-01-01T00:00:00.000Z", at("2026-01-01T00:00:00.000Z")),
    ]);
    transactions.changesSince.mockResolvedValue([
      transaction(
        "t1",
        "2026-01-02T00:00:00.000Z",
        at("2026-01-02T00:00:00.000Z"),
      ),
    ]);

    const page = await service.getChanges(USER_ID, undefined, 50);

    expect(page.changes.accounts[0]?.archivedAt).toEqual(
      at("2026-01-01T00:00:00.000Z"),
    );
    expect(page.changes.transactions[0]?.deletedAt).toEqual(
      at("2026-01-02T00:00:00.000Z"),
    );
  });

  it("includes the profile, and only when it moved after the cursor", async () => {
    const { service, users } = build();
    users.getById.mockResolvedValue(user);

    const snapshot = await service.getChanges(USER_ID, undefined, 50);
    expect(snapshot.changes.user?.id).toBe(USER_ID);
    // Never the password hash.
    expect(snapshot.changes.user).not.toHaveProperty("password");

    const later = await service.getChanges(
      USER_ID,
      { updatedAt: at("2026-06-01T00:00:00.000Z"), id: null },
      50,
    );
    expect(later.changes.user).toBeNull();
  });

  it("counts every entity in the page, budgets and categories included", async () => {
    const { service, categories, budgets } = build();
    categories.changesSince.mockResolvedValue([
      category("c1", "2026-01-02T00:00:00.000Z"),
    ]);
    budgets.changesSince.mockResolvedValue([
      budget("b1", "2026-01-03T00:00:00.000Z"),
    ]);

    const page = await service.getChanges(USER_ID, undefined, 50);

    expect(page.pagination.count).toBe(2);
    expect(page.changes.categories).toHaveLength(1);
    expect(page.changes.budgets).toHaveLength(1);
  });

  // The watermark must not claim to cover a write that landed mid-page.
  it("stamps serverTime before reading, not after", async () => {
    const { service, accounts } = build();
    accounts.changesSince.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 20)),
    );

    const before = Date.now();
    const page = await service.getChanges(USER_ID, undefined, 50);

    expect(page.serverTime.getTime()).toBeLessThan(before + 20);
  });
});
