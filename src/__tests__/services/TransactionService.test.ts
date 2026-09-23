jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "MONGO",
    JWT_SECRET: "test",
    BCRYPT_SALT_ROUNDS: 12,
    JWT_EXPIRATION: "24h",
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  DB_TYPES: { MONGO: "MONGO" },
  TRANSACTION_SOURCES: { MANUAL: "MANUAL", QUICK: "QUICK", IMPORT: "IMPORT" },
  DEBT_ACCOUNT_FIELDS: {
    creditLimit: ["CARD", "OVERDRAFT"],
    borrowedAmount: ["LOAN"],
  },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
    ADJUSTMENT: "ADJUSTMENT",
    SETTLEMENT: "SETTLEMENT",
  },
  CATEGORY_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
  },
  MODEL_NAMES: {
    USER: "User",
    ACCOUNT: "Account",
    TRANSACTION: "Transaction",
    CATEGORY: "Category",
  },
  SHARED_HISTORY_REASONS: {
    SPLIT: "SPLIT",
    SPLIT_EDITED: "SPLIT_EDITED",
    AMOUNT_CHANGED: "AMOUNT_CHANGED",
    UNSPLIT: "UNSPLIT",
    PAYMENT: "PAYMENT",
    REIMPUTED: "REIMPUTED",
  },
  SHARE_PARTIES: { USER: "USER", CONTACT: "CONTACT", GUESTS: "GUESTS" },
  SPLIT_MODES: {
    EQUAL: "EQUAL",
    PERCENT: "PERCENT",
    EXACT: "EXACT",
    FIXED_REST: "FIXED_REST",
  },
  TYPES_OUTSIDE_SPENDING: ["ADJUSTMENT", "SETTLEMENT"],
  TYPES_RECORDED_ELSEWHERE: ["SETTLEMENT"],
  SETTLEMENT_PARTIES: { CONTACT: "CONTACT", GUESTS: "GUESTS" },
  GROUP_STATUSES: { OPEN: "OPEN", SETTLED: "SETTLED" },
}));

// The transactional callback runs inline with a dummy session: no real MongoDB session here.
jest.mock("../../shared/unitOfWork", () => ({
  withTransaction: jest.fn((fn: (session: unknown) => unknown) =>
    fn("test-session"),
  ),
}));

import { CreateTransactionDTO } from "../../app/dtos/TransactionDTO";
import { SharedLedgerService } from "../../app/services/SharedLedgerService";
import { TransactionService } from "../../app/services/TransactionService";
import { Account } from "../../domain/entities/Account";
import { Category } from "../../domain/entities/Category";
import { SharedExpense } from "../../domain/entities/SharedExpense";
import { Transaction } from "../../domain/entities/Transaction";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { IIdempotencyRepository } from "../../domain/repositories/idempotency/IIdempotencyRepository";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedSettlementRepository } from "../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";

const USER = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const TZ = "America/Bogota";
const ACC_A = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";
const ACC_B = "019576a0-d7b6-7d6d-af6a-2b7545f5ac72";
const TX_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac80";

const createMockSharedExpenseRepo =
  (): jest.Mocked<ISharedExpenseRepository> => ({
    atJoin: jest.fn().mockResolvedValue([]),
    changesInGroups: jest.fn().mockResolvedValue([]),
    getAll: jest.fn(),
    getAllByGroup: jest.fn(),
    getById: jest.fn(),
    getByIdIncludingDeleted: jest.fn(),
    getOwnById: jest.fn(),
    listByGroup: jest.fn().mockResolvedValue([]),
    listByCounterparty: jest.fn().mockResolvedValue([]),
    changesSince: jest.fn().mockResolvedValue([]),
    countSharesOfContact: jest.fn().mockResolvedValue(0),
    totalsByGroup: jest.fn().mockResolvedValue([]),
    replaceSplits: jest.fn().mockResolvedValue(undefined),
    stampsOf: jest.fn().mockResolvedValue(new Map()),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  });

const createMockSettlementRepo =
  (): jest.Mocked<ISharedSettlementRepository> => ({
    getAll: jest.fn(),
    getAllByUserId: jest.fn(),
    getById: jest.fn(),
    getOwnById: jest.fn(),
    listByCounterparty: jest.fn().mockResolvedValue([]),
    changesSince: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  });

const createMockTransactionRepo = (): jest.Mocked<ITransactionRepository> => ({
  getImported: jest.fn().mockResolvedValue(null),
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getOwnById: jest.fn(),
  isDeleted: jest.fn().mockResolvedValue(false),
  getBySharedExpenseId: jest.fn().mockResolvedValue(null),
  listBySharedExpenseIds: jest.fn().mockResolvedValue([]),
  stampsOf: jest.fn().mockResolvedValue(new Map()),
  listBySettlementId: jest.fn().mockResolvedValue([]),
  applySharedChange: jest.fn(),
  changesSince: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  aggregateSpending: jest.fn(),
  listTags: jest.fn().mockResolvedValue([]),
  countByCategory: jest.fn().mockResolvedValue(0),
  sumAmountsByCategory: jest.fn(),
  sumAmounts: jest.fn().mockResolvedValue(0),
});

const createMockAccountRepo = (): jest.Mocked<IAccountRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn(),
  changesSince: jest.fn().mockResolvedValue([]),
  findActiveByName: jest.fn().mockResolvedValue(null),
  getOwnById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  incrementBalance: jest.fn().mockResolvedValue(true),
  incrementBalanceCapped: jest.fn().mockResolvedValue("applied"),
  archiveNonDefault: jest.fn().mockResolvedValue(null),
  restore: jest.fn(),
  getDefaultByUserId: jest.fn(),
  setDefault: jest.fn(),
  countByUserId: jest.fn(),
});

const createMockIdempotencyRepo = (): jest.Mocked<IIdempotencyRepository> => ({
  find: jest.fn().mockResolvedValue(null),
  record: jest.fn().mockResolvedValue(undefined),
});

const createMockCategoryRepo = (): jest.Mocked<ICategoryRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn(),
  changesSince: jest.fn().mockResolvedValue([]),
  findActiveByName: jest.fn().mockResolvedValue(null),
  getOwnById: jest.fn(),
  create: jest.fn(),
  createMany: jest.fn(),
  listSeedKeys: jest.fn().mockResolvedValue([]),
  listArchivedIds: jest.fn().mockResolvedValue([]),
  countByUserId: jest.fn().mockResolvedValue(0),
  update: jest.fn(),
  delete: jest.fn(),
  restore: jest.fn(),
});

const account = (overrides: Partial<Account> = {}): Account =>
  new Account({
    id: ACC_A,
    name: "Savings",
    type: "SAVINGS",
    balance: 1000,
    userId: USER,
    ...overrides,
  });

describe("TransactionService", () => {
  let service: TransactionService;
  let txRepo: jest.Mocked<ITransactionRepository>;
  let acctRepo: jest.Mocked<IAccountRepository>;
  let idempotencyRepo: jest.Mocked<IIdempotencyRepository>;
  let categoryRepo: jest.Mocked<ICategoryRepository>;
  let sharedExpenseRepo: jest.Mocked<ISharedExpenseRepository>;

  beforeEach(() => {
    txRepo = createMockTransactionRepo();
    acctRepo = createMockAccountRepo();
    idempotencyRepo = createMockIdempotencyRepo();
    categoryRepo = createMockCategoryRepo();
    sharedExpenseRepo = createMockSharedExpenseRepo();
    service = new TransactionService(
      txRepo,
      acctRepo,
      idempotencyRepo,
      categoryRepo,
      new SharedLedgerService(
        sharedExpenseRepo,
        createMockSettlementRepo(),
        txRepo,
      ),
    );
    acctRepo.incrementBalance.mockResolvedValue(true);
  });

  describe("createTransaction", () => {
    it("freezes the accounting day of the account's zone, not the UTC one [T-14]", async () => {
      acctRepo.getById.mockResolvedValue(account());
      txRepo.create.mockImplementation(async (tx) => tx as Transaction);

      // 11pm on Aug 31 in Bogota is already Sep 1 in UTC.
      const created = await service.createTransaction(
        {
          type: "EXPENSE",
          amount: 30,
          date: new Date("2026-09-01T04:00:00.000Z"),
          fromAccountId: ACC_A,
          userId: USER,
        },
        TZ,
      );

      expect(created.dayKey).toBe("2026-08-31");
    });

    it("applies an ADJUSTMENT as a signed increment on the single account [R2-06]", async () => {
      acctRepo.getById.mockResolvedValue(account());
      txRepo.create.mockImplementation(async (tx) => tx as Transaction);

      await service.createTransaction(
        {
          type: "ADJUSTMENT",
          amount: 30,
          date: new Date("2026-08-31"),
          fromAccountId: ACC_A,
          userId: USER,
        },
        TZ,
      );
      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        -30,
        "test-session",
      );

      await service.createTransaction(
        {
          type: "ADJUSTMENT",
          amount: 30,
          date: new Date("2026-08-31"),
          toAccountId: ACC_B,
          userId: USER,
        },
        TZ,
      );
      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_B,
        30,
        "test-session",
      );
    });

    it("refuses an income landing on a debt account, and touches no balance [T-93]", async () => {
      acctRepo.getById.mockResolvedValue(
        account({ type: "CARD", balance: -1245.9 }),
      );

      await expect(
        service.createTransaction(
          {
            type: "INCOME",
            amount: 600,
            date: new Date("2026-09-05"),
            toAccountId: ACC_A,
            userId: USER,
          },
          TZ,
        ),
      ).rejects.toMatchObject({ code: "INCOME_ON_CARD_OR_LOAN" });

      expect(acctRepo.incrementBalance).not.toHaveBeenCalled();
      expect(acctRepo.incrementBalanceCapped).not.toHaveBeenCalled();
      expect(txRepo.create).not.toHaveBeenCalled();
    });

    it("lets money reach a debt account as a transfer or an adjustment [T-93]", async () => {
      acctRepo.getById.mockResolvedValue(
        account({ type: "CARD", balance: -1245.9 }),
      );
      txRepo.create.mockImplementation(async (tx) => tx as Transaction);

      await service.createTransaction(
        {
          type: "ADJUSTMENT",
          amount: 600,
          date: new Date("2026-09-05"),
          toAccountId: ACC_A,
          userId: USER,
        },
        TZ,
      );

      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        600,
        "test-session",
      );
    });

    it("caps what reaches a loan at what it still owes [T-93]", async () => {
      acctRepo.getById.mockResolvedValue(
        account({ type: "LOAN", balance: -8400 }),
      );
      txRepo.create.mockImplementation(async (tx) => tx as Transaction);

      await service.createTransaction(
        {
          type: "ADJUSTMENT",
          amount: 8400,
          date: new Date("2026-09-05"),
          toAccountId: ACC_A,
          userId: USER,
        },
        TZ,
      );

      expect(acctRepo.incrementBalanceCapped).toHaveBeenCalledWith(
        ACC_A,
        8400,
        0,
        "test-session",
      );
      expect(acctRepo.incrementBalance).not.toHaveBeenCalled();

      acctRepo.incrementBalanceCapped.mockResolvedValue("over");
      await expect(
        service.createTransaction(
          {
            type: "ADJUSTMENT",
            amount: 9000,
            date: new Date("2026-09-05"),
            toAccountId: ACC_A,
            userId: USER,
          },
          TZ,
        ),
      ).rejects.toMatchObject({ code: "LOAN_OVERPAID" });
    });

    it("leaves money going out of a loan alone: only what arrives is capped [T-93]", async () => {
      acctRepo.getById.mockResolvedValue(
        account({ type: "LOAN", balance: -8400 }),
      );
      txRepo.create.mockImplementation(async (tx) => tx as Transaction);

      await service.createTransaction(
        {
          type: "EXPENSE",
          amount: 100,
          date: new Date("2026-09-05"),
          fromAccountId: ACC_A,
          userId: USER,
        },
        TZ,
      );

      expect(acctRepo.incrementBalanceCapped).not.toHaveBeenCalled();
      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        -100,
        "test-session",
      );
    });

    it("debits the source account for an EXPENSE (atomic increment)", async () => {
      acctRepo.getById.mockResolvedValue(account());
      const dto: CreateTransactionDTO = {
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      };
      txRepo.create.mockResolvedValue(new Transaction({ id: TX_ID, ...dto }));

      await service.createTransaction(dto, TZ);

      expect(acctRepo.incrementBalance).toHaveBeenCalledTimes(1);
      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        -100,
        "test-session",
      );
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.any(Transaction),
        "test-session",
      );
    });

    it("credits the destination account for an INCOME", async () => {
      acctRepo.getById.mockResolvedValue(account({ id: ACC_B }));
      const dto: CreateTransactionDTO = {
        type: "INCOME",
        amount: 200,
        date: new Date("2026-03-28"),
        toAccountId: ACC_B,
        userId: USER,
      };
      txRepo.create.mockResolvedValue(new Transaction({ id: TX_ID, ...dto }));

      await service.createTransaction(dto, TZ);

      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_B,
        200,
        "test-session",
      );
    });

    it("moves money between accounts for a TRANSFER", async () => {
      acctRepo.getById.mockImplementation(async (id) =>
        id === ACC_A ? account() : account({ id: ACC_B }),
      );
      const dto: CreateTransactionDTO = {
        type: "TRANSFER",
        amount: 150,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        toAccountId: ACC_B,
        userId: USER,
      };
      txRepo.create.mockResolvedValue(new Transaction({ id: TX_ID, ...dto }));

      await service.createTransaction(dto, TZ);

      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        -150,
        "test-session",
      );
      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_B,
        150,
        "test-session",
      );
    });

    it("preserves 2-decimal amounts exactly (no float drift)", async () => {
      acctRepo.getById.mockResolvedValue(account());
      const dto: CreateTransactionDTO = {
        type: "EXPENSE",
        amount: 10.55,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      };
      txRepo.create.mockResolvedValue(new Transaction({ id: TX_ID, ...dto }));

      await service.createTransaction(dto, TZ);

      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        -10.55,
        "test-session",
      );
    });

    it("rejects when the source account does not exist", async () => {
      acctRepo.getById.mockResolvedValue(null);
      await expect(
        service.createTransaction(
          {
            type: "EXPENSE",
            amount: 100,
            date: new Date("2026-03-28"),
            fromAccountId: ACC_A,
            userId: USER,
          },
          TZ,
        ),
      ).rejects.toThrow("Source account not found");
      expect(txRepo.create).not.toHaveBeenCalled();
    });

    it("rejects when the account belongs to another user", async () => {
      acctRepo.getById.mockResolvedValue(account({ userId: "someone-else" }));
      await expect(
        service.createTransaction(
          {
            type: "EXPENSE",
            amount: 100,
            date: new Date("2026-03-28"),
            fromAccountId: ACC_A,
            userId: USER,
          },
          TZ,
        ),
      ).rejects.toThrow("Source account not found");
      expect(txRepo.create).not.toHaveBeenCalled();
    });

    it("rejects an invalid amount before touching balances", async () => {
      await expect(
        service.createTransaction(
          {
            type: "EXPENSE",
            amount: 0,
            date: new Date("2026-03-28"),
            fromAccountId: ACC_A,
            userId: USER,
          },
          TZ,
        ),
      ).rejects.toThrow("Amount must be greater than 0");
      expect(acctRepo.incrementBalance).not.toHaveBeenCalled();
    });

    it("rejects an EXPENSE that also carries a destination account [B10]", async () => {
      await expect(
        service.createTransaction(
          {
            type: "EXPENSE",
            amount: 50,
            date: new Date("2026-03-28"),
            fromAccountId: ACC_A,
            toAccountId: ACC_B,
            userId: USER,
          },
          TZ,
        ),
      ).rejects.toThrow("toAccountId is not allowed");
      expect(acctRepo.incrementBalance).not.toHaveBeenCalled();
    });

    it("replays the existing transaction for a repeated idempotency key", async () => {
      const stored = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      });
      idempotencyRepo.find.mockResolvedValue({
        transactionId: TX_ID,
        requestHash: "h1",
      });
      txRepo.getById.mockResolvedValue(stored);

      const result = await service.createTransaction(
        {
          type: "EXPENSE",
          amount: 100,
          date: new Date("2026-03-28"),
          fromAccountId: ACC_A,
          userId: USER,
        },
        TZ,
        { key: "key-1", requestHash: "h1" },
      );

      expect(result.id).toBe(TX_ID);
      expect(acctRepo.incrementBalance).not.toHaveBeenCalled();
      expect(txRepo.create).not.toHaveBeenCalled();
    });

    it("rejects a reused idempotency key with a different payload (422) [R2-10]", async () => {
      idempotencyRepo.find.mockResolvedValue({
        transactionId: TX_ID,
        requestHash: "hash-of-original",
      });

      await expect(
        service.createTransaction(
          {
            type: "EXPENSE",
            amount: 999,
            date: new Date("2026-03-28"),
            fromAccountId: ACC_A,
            userId: USER,
          },
          TZ,
          { key: "key-1", requestHash: "hash-of-different-body" },
        ),
      ).rejects.toThrow("different payload");
      expect(txRepo.create).not.toHaveBeenCalled();
    });

    it("returns 409 when the original transaction of the key was deleted [R2-10]", async () => {
      idempotencyRepo.find.mockResolvedValue({
        transactionId: TX_ID,
        requestHash: "h1",
      });
      txRepo.getById.mockResolvedValue(null);

      await expect(
        service.createTransaction(
          {
            type: "EXPENSE",
            amount: 100,
            date: new Date("2026-03-28"),
            fromAccountId: ACC_A,
            userId: USER,
          },
          TZ,
          { key: "key-1", requestHash: "h1" },
        ),
      ).rejects.toThrow("was deleted");
      expect(txRepo.create).not.toHaveBeenCalled();
    });
  });

  describe("updateTransaction", () => {
    it("reverses the old effect and applies the new one", async () => {
      const existing = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(existing);
      acctRepo.getById.mockResolvedValue(account());
      txRepo.update.mockResolvedValue(
        new Transaction({ ...existing, amount: 175 }),
      );

      await service.updateTransaction(TX_ID, { amount: 175 }, USER, TZ);

      // reverse old (+100 back), then apply new (-175)
      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        100,
        "test-session",
      );
      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        -175,
        "test-session",
      );
    });

    // T-67: precision is a rule about the amount being written, not about the one already stored.
    it("edits a row stored before the rule without touching its amount", async () => {
      const legacy = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 1000.5,
        currency: "COP",
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(legacy);
      acctRepo.getById.mockResolvedValue(account());
      txRepo.update.mockResolvedValue(legacy);

      await expect(
        service.updateTransaction(TX_ID, { description: "otro" }, USER, TZ),
      ).resolves.toBeDefined();

      await expect(
        service.updateTransaction(TX_ID, { amount: 2000.5 }, USER, TZ),
      ).rejects.toThrow("COP amounts cannot have decimals");
    });

    it("records a pre-update snapshot only on monetary changes [R2-27]", async () => {
      const existing = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(existing);
      acctRepo.getById.mockResolvedValue(account());
      txRepo.update.mockResolvedValue(existing);

      await service.updateTransaction(TX_ID, { amount: 175 }, USER, TZ);
      expect(txRepo.update).toHaveBeenCalledWith(
        TX_ID,
        { amount: 175, countsAsYours: 175 },
        "test-session",
        expect.objectContaining({ amount: 100, type: "EXPENSE" }),
        undefined,
      );

      txRepo.update.mockClear();
      await service.updateTransaction(TX_ID, { note: "x" }, USER, TZ);
      expect(txRepo.update).toHaveBeenCalledWith(
        TX_ID,
        { note: "x" },
        "test-session",
        undefined,
        undefined,
      );
    });

    it("a date-only edit records a revision without touching balances", async () => {
      const existing = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(existing);
      txRepo.update.mockResolvedValue(existing);

      await service.updateTransaction(
        TX_ID,
        { date: new Date("2026-04-02") },
        USER,
        TZ,
      );

      expect(acctRepo.incrementBalance).not.toHaveBeenCalled();
      expect(txRepo.update).toHaveBeenCalledWith(
        TX_ID,
        // T-14: the day is re-stamped because midnight UTC on Apr 2 is still Apr 1 in Bogota.
        { date: new Date("2026-04-02"), dayKey: "2026-04-01" },
        "test-session",
        expect.objectContaining({ date: new Date("2026-03-28") }),
        undefined,
      );
    });

    it("leaves the accounting day alone when the edit does not move the date [T-14]", async () => {
      const existing = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28T04:30:00.000Z"),
        dayKey: "2026-03-27",
        fromAccountId: ACC_A,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(existing);
      txRepo.update.mockResolvedValue(existing);

      // The account moved zones: an unrelated edit must not re-book a past expense.
      await service.updateTransaction(
        TX_ID,
        { description: "renamed" },
        USER,
        "Europe/Madrid",
      );

      expect(txRepo.update).toHaveBeenCalledWith(
        TX_ID,
        { description: "renamed" },
        "test-session",
        undefined,
        undefined,
      );
    });

    it("skips balance adjustments when no monetary field changes [R2-19]", async () => {
      const existing = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(existing);
      txRepo.update.mockResolvedValue(
        new Transaction({ ...existing, note: "coffee" }),
      );

      // Works even if the account is archived: no account lookup happens.
      acctRepo.getById.mockResolvedValue(null);

      await service.updateTransaction(TX_ID, { note: "coffee" }, USER, TZ);

      expect(acctRepo.incrementBalance).not.toHaveBeenCalled();
      expect(acctRepo.getById).not.toHaveBeenCalled();
      expect(txRepo.update).toHaveBeenCalled();
    });

    it("rejects an update that would leave an invalid shape (INCOME without destination)", async () => {
      const existing = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(existing);

      await expect(
        service.updateTransaction(TX_ID, { type: "INCOME" }, USER, TZ),
      ).rejects.toThrow("toAccountId is required");
      expect(txRepo.update).not.toHaveBeenCalled();
    });

    it("denies updating a transaction owned by another user", async () => {
      txRepo.getById.mockResolvedValue(
        new Transaction({
          id: TX_ID,
          type: "EXPENSE",
          amount: 100,
          date: new Date("2026-03-28"),
          fromAccountId: ACC_A,
          userId: "other-user",
        }),
      );

      await expect(
        service.updateTransaction(TX_ID, { amount: 50 }, USER, TZ),
      ).rejects.toThrow("Transaction not found");
    });
  });

  describe("a movement in a shared group [T-115]", () => {
    const EXPENSE_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5acb1";
    const GROUP_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5acb2";
    const ANA = "019576a0-d7b6-7d6d-af6a-2b7545f5acb3";

    const split = new Transaction({
      id: TX_ID,
      type: "EXPENSE",
      amount: 120000,
      currency: "COP",
      date: new Date("2026-08-12T18:00:00.000Z"),
      description: "Corner store",
      fromAccountId: ACC_A,
      userId: USER,
      sharedExpenseId: EXPENSE_ID,
      sharedGroupId: GROUP_ID,
    });

    const expense = (mode = "EQUAL"): SharedExpense =>
      new SharedExpense({
        id: EXPENSE_ID,
        groupId: GROUP_ID,
        description: "Corner store",
        date: new Date("2026-08-12T18:00:00.000Z"),
        amount: 120000,
        userId: USER,
        updatedAt: new Date("2026-08-12T19:00:00.000Z"),
        currency: "COP",
        customSplit: mode !== "EQUAL",
        split: {
          mode: mode as "EQUAL" | "EXACT",
          guests: null,
          shares: [
            {
              party: "USER",
              contactId: null,
              percent: null,
              fixedAmount: mode === "EXACT" ? 100000 : null,
              amount: mode === "EXACT" ? 100000 : 60000,
              collected: 0,
            },
            {
              party: "CONTACT",
              contactId: ANA,
              percent: null,
              fixedAmount: mode === "EXACT" ? 20000 : null,
              amount: mode === "EXACT" ? 20000 : 60000,
              collected: 0,
            },
          ],
        },
      });

    beforeEach(() => {
      txRepo.getById.mockResolvedValue(split);
      acctRepo.getById.mockResolvedValue(account());
      txRepo.update.mockImplementation(
        async (_id, patch) =>
          new Transaction({ ...split, ...(patch as object) }),
      );
      txRepo.applySharedChange.mockImplementation(
        async (_id, _userId, patch) => new Transaction({ ...split, ...patch }),
      );
      sharedExpenseRepo.getById.mockResolvedValue(expense());
      sharedExpenseRepo.update.mockResolvedValue(expense());
    });

    it("resolves the split again on a new amount, and says so in the history", async () => {
      const saved = await service.updateTransaction(
        TX_ID,
        { amount: 150000 },
        USER,
        TZ,
      );

      expect(sharedExpenseRepo.update).toHaveBeenCalledWith(
        EXPENSE_ID,
        expect.objectContaining({
          amount: 150000,
          split: expect.objectContaining({
            shares: [
              expect.objectContaining({ amount: 75000 }),
              expect.objectContaining({ amount: 75000 }),
            ],
          }),
        }),
        "test-session",
      );
      expect(txRepo.applySharedChange).toHaveBeenCalledWith(
        TX_ID,
        USER,
        expect.objectContaining({
          sharedExpenseId: EXPENSE_ID,
          countsAsYours: 150000,
        }),
        expect.objectContaining({
          reason: "AMOUNT_CHANGED",
          countsAsYours: 150000,
        }),
        "test-session",
      );
      expect(saved.countsAsYours).toBe(150000);
    });

    // What T-116 will write: half of it came back, so a new amount must not hand it back.
    it("carries what came back across a new amount", async () => {
      const halfPaid = new Transaction({ ...split, countsAsYours: 60000 });
      txRepo.getById.mockResolvedValue(halfPaid);
      txRepo.update.mockImplementation(
        async (_id, patch) =>
          new Transaction({ ...halfPaid, ...(patch as object) }),
      );

      const saved = await service.updateTransaction(
        TX_ID,
        { amount: 150000 },
        USER,
        TZ,
      );

      expect(saved.countsAsYours).toBe(90000);
      expect(txRepo.update).toHaveBeenCalledWith(
        TX_ID,
        expect.objectContaining({ amount: 150000, countsAsYours: 90000 }),
        "test-session",
        expect.anything(),
        undefined,
      );
    });

    it("refuses a new amount when the split states exact figures", async () => {
      sharedExpenseRepo.getById.mockResolvedValue(expense("EXACT"));

      await expect(
        service.updateTransaction(TX_ID, { amount: 150000 }, USER, TZ),
      ).rejects.toMatchObject({ code: "SPLIT_INVALID" });
    });

    it("carries the date and the description over without moving the figure", async () => {
      await service.updateTransaction(
        TX_ID,
        { description: "Dinner" },
        USER,
        TZ,
      );

      expect(sharedExpenseRepo.update).toHaveBeenCalledWith(
        EXPENSE_ID,
        expect.objectContaining({ description: "Dinner" }),
        "test-session",
      );
      expect(txRepo.applySharedChange).not.toHaveBeenCalled();
    });

    it("leaves the expense alone when nothing it states changed", async () => {
      await service.updateTransaction(TX_ID, { note: "with Ana" }, USER, TZ);

      expect(sharedExpenseRepo.update).not.toHaveBeenCalled();
    });

    it("refuses to turn it into another type", async () => {
      await expect(
        service.updateTransaction(
          TX_ID,
          { type: "INCOME", fromAccountId: null, toAccountId: ACC_B },
          USER,
          TZ,
        ),
      ).rejects.toMatchObject({ code: "TRANSACTION_NOT_SPLITTABLE" });
    });

    it("takes the expense out of the group when the movement is deleted", async () => {
      txRepo.delete.mockResolvedValue();
      sharedExpenseRepo.delete.mockResolvedValue(expense());

      await service.deleteTransaction(TX_ID, USER);

      expect(sharedExpenseRepo.delete).toHaveBeenCalledWith(
        EXPENSE_ID,
        "test-session",
      );
    });
  });

  describe("deleteTransaction", () => {
    it("reverses the balance effect and deletes within the transaction", async () => {
      const existing = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(existing);
      txRepo.delete.mockResolvedValue();

      await service.deleteTransaction(TX_ID, USER);

      // reversal adds the expense back to the source account
      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        100,
        "test-session",
      );
      expect(txRepo.delete).toHaveBeenCalledWith(
        TX_ID,
        "test-session",
        undefined,
      );
    });

    it("denies deleting a transaction owned by another user", async () => {
      txRepo.getById.mockResolvedValue(
        new Transaction({
          id: TX_ID,
          type: "EXPENSE",
          amount: 100,
          date: new Date("2026-03-28"),
          fromAccountId: ACC_A,
          userId: "other-user",
        }),
      );

      await expect(service.deleteTransaction(TX_ID, USER)).rejects.toThrow(
        "Transaction not found",
      );
      expect(txRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe("quickAddTransaction [F2]", () => {
    it("uses the default account and flags pendingDetails", async () => {
      acctRepo.getDefaultByUserId.mockResolvedValue(account());
      acctRepo.getById.mockResolvedValue(account());
      txRepo.create.mockImplementation(
        async (t) => new Transaction({ ...(t as object), id: TX_ID } as never),
      );

      await service.quickAddTransaction({ amount: 20, userId: USER }, TZ);

      expect(acctRepo.getDefaultByUserId).toHaveBeenCalledWith(USER);
      const created = txRepo.create.mock.calls[0][0];
      expect(created.pendingDetails).toBe(true);
      expect(created.fromAccountId).toBe(ACC_A);
      expect(created.type).toBe("EXPENSE");
    });

    it("rejects when no default account is set", async () => {
      acctRepo.getDefaultByUserId.mockResolvedValue(null);

      await expect(
        service.quickAddTransaction({ amount: 20, userId: USER }, TZ),
      ).rejects.toThrow("No default account");
      expect(txRepo.create).not.toHaveBeenCalled();
    });
  });

  describe("currency [multi-moneda etapa 1]", () => {
    it("stamps the account's currency on the transaction", async () => {
      acctRepo.getById.mockResolvedValue(account({ currency: "COP" }));
      txRepo.create.mockImplementation(async (tx) => tx as Transaction);

      const created = await service.createTransaction(
        {
          type: "EXPENSE",
          amount: 10,
          date: new Date("2026-03-28"),
          fromAccountId: ACC_A,
          userId: USER,
        },
        TZ,
      );

      expect(created.currency).toBe("COP");
    });

    it("rejects a transfer between accounts of different currencies", async () => {
      acctRepo.getById.mockImplementation(async (id) =>
        id === ACC_A
          ? account({ currency: "COP" })
          : account({ id: ACC_B, currency: "USD" }),
      );

      await expect(
        service.createTransaction(
          {
            type: "TRANSFER",
            amount: 10,
            date: new Date("2026-03-28"),
            fromAccountId: ACC_A,
            toAccountId: ACC_B,
            userId: USER,
          },
          TZ,
        ),
      ).rejects.toThrow("different currencies");
      expect(txRepo.create).not.toHaveBeenCalled();
    });
  });

  describe("source [R2-27b]", () => {
    it("quick-add marks source QUICK; normal create defaults to MANUAL", async () => {
      acctRepo.getById.mockResolvedValue(account());
      acctRepo.getDefaultByUserId.mockResolvedValue(account());
      txRepo.create.mockImplementation(async (tx) => tx as Transaction);

      const quick = await service.quickAddTransaction(
        {
          amount: 5,
          userId: USER,
        },
        TZ,
      );
      expect(quick.source).toBe("QUICK");

      const manual = await service.createTransaction(
        {
          type: "EXPENSE",
          amount: 10,
          date: new Date("2026-03-28"),
          fromAccountId: ACC_A,
          userId: USER,
        },
        TZ,
      );
      expect(manual.source).toBe("MANUAL");
    });
  });

  describe("category validation [R2-05]", () => {
    const CAT = "019576a0-d7b6-7d6d-af6a-2b7545f5ac90";
    const expenseDto = (): CreateTransactionDTO => ({
      type: "EXPENSE",
      amount: 100,
      date: new Date("2026-03-28"),
      fromAccountId: ACC_A,
      categoryId: CAT,
      userId: USER,
    });

    beforeEach(() => {
      acctRepo.getById.mockResolvedValue(account());
      txRepo.create.mockImplementation(async (tx) => tx as Transaction);
    });

    it("rejects a nonexistent category", async () => {
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(service.createTransaction(expenseDto(), TZ)).rejects.toThrow(
        "Category not found",
      );
      expect(txRepo.create).not.toHaveBeenCalled();
    });

    it("rejects another user's category without revealing it exists", async () => {
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({ id: CAT, name: "Food", userId: "someone-else" }),
      );

      await expect(service.createTransaction(expenseDto(), TZ)).rejects.toThrow(
        "Category not found",
      );
    });

    it("rejects assigning an archived category", async () => {
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({
          id: CAT,
          name: "Food",
          userId: USER,
          archivedAt: new Date(),
        }),
      );

      await expect(service.createTransaction(expenseDto(), TZ)).rejects.toThrow(
        "Category is archived",
      );
    });

    it("rejects a category whose type contradicts the transaction type", async () => {
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({ id: CAT, name: "Salary", type: "INCOME", userId: USER }),
      );

      await expect(service.createTransaction(expenseDto(), TZ)).rejects.toThrow(
        "does not match transaction type",
      );
    });

    it("accepts an active category of the user with a matching type", async () => {
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({ id: CAT, name: "Food", type: "EXPENSE", userId: USER }),
      );

      await expect(
        service.createTransaction(expenseDto(), TZ),
      ).resolves.toBeDefined();
      expect(txRepo.create).toHaveBeenCalled();
    });

    it("keeps an archived category on update when it does not change", async () => {
      const existing = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        categoryId: CAT,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(existing);
      txRepo.update.mockResolvedValue(
        new Transaction({ ...existing, amount: 175 }),
      );
      categoryRepo.getByIdIncludingArchived.mockResolvedValue(
        new Category({
          id: CAT,
          name: "Food",
          userId: USER,
          archivedAt: new Date(),
        }),
      );

      await expect(
        service.updateTransaction(TX_ID, { amount: 175 }, USER, TZ),
      ).resolves.toBeDefined();
    });
  });

  describe("getTransactionById", () => {
    it("returns the transaction when owned", async () => {
      const tx = new Transaction({
        id: TX_ID,
        type: "EXPENSE",
        amount: 100,
        date: new Date("2026-03-28"),
        fromAccountId: ACC_A,
        userId: USER,
      });
      txRepo.getById.mockResolvedValue(tx);
      await expect(service.getTransactionById(TX_ID, USER)).resolves.toBe(tx);
    });

    it("throws NotFound when missing", async () => {
      txRepo.getById.mockResolvedValue(null);
      await expect(service.getTransactionById(TX_ID, USER)).rejects.toThrow(
        "Transaction not found",
      );
    });
  });
});
