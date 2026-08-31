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
  TRANSACTION_TYPES: { INCOME: "INCOME", EXPENSE: "EXPENSE", TRANSFER: "TRANSFER" },
  MODEL_NAMES: {
    USER: "User",
    ACCOUNT: "Account",
    TRANSACTION: "Transaction",
    CATEGORY: "Category",
  },
}));

// Run the transactional callback inline with a dummy session so the service can
// be unit-tested against mocked repositories (no real MongoDB session).
jest.mock("../../shared/unitOfWork", () => ({
  withTransaction: jest.fn((fn: (session: unknown) => unknown) =>
    fn("test-session"),
  ),
}));

import { CreateTransactionDTO } from "../../app/dtos/TransactionDTO";
import { TransactionService } from "../../app/services/TransactionService";
import { Account } from "../../domain/entities/Account";
import { Transaction } from "../../domain/entities/Transaction";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";

const USER = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const ACC_A = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";
const ACC_B = "019576a0-d7b6-7d6d-af6a-2b7545f5ac72";
const TX_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac80";

const createMockTransactionRepo = (): jest.Mocked<ITransactionRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

const createMockAccountRepo = (): jest.Mocked<IAccountRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  incrementBalance: jest.fn(),
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

  beforeEach(() => {
    txRepo = createMockTransactionRepo();
    acctRepo = createMockAccountRepo();
    service = new TransactionService(txRepo, acctRepo);
    acctRepo.incrementBalance.mockResolvedValue(account());
  });

  describe("createTransaction", () => {
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

      await service.createTransaction(dto);

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

      await service.createTransaction(dto);

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

      await service.createTransaction(dto);

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

      await service.createTransaction(dto);

      expect(acctRepo.incrementBalance).toHaveBeenCalledWith(
        ACC_A,
        -10.55,
        "test-session",
      );
    });

    it("rejects when the source account does not exist", async () => {
      acctRepo.getById.mockResolvedValue(null);
      await expect(
        service.createTransaction({
          type: "EXPENSE",
          amount: 100,
          date: new Date("2026-03-28"),
          fromAccountId: ACC_A,
          userId: USER,
        }),
      ).rejects.toThrow("Source account not found");
      expect(txRepo.create).not.toHaveBeenCalled();
    });

    it("rejects when the account belongs to another user", async () => {
      acctRepo.getById.mockResolvedValue(account({ userId: "someone-else" }));
      await expect(
        service.createTransaction({
          type: "EXPENSE",
          amount: 100,
          date: new Date("2026-03-28"),
          fromAccountId: ACC_A,
          userId: USER,
        }),
      ).rejects.toThrow("does not belong to the user");
      expect(txRepo.create).not.toHaveBeenCalled();
    });

    it("rejects an invalid amount before touching balances", async () => {
      await expect(
        service.createTransaction({
          type: "EXPENSE",
          amount: 0,
          date: new Date("2026-03-28"),
          fromAccountId: ACC_A,
          userId: USER,
        }),
      ).rejects.toThrow("Amount must be greater than 0");
      expect(acctRepo.incrementBalance).not.toHaveBeenCalled();
    });

    it("rejects an EXPENSE that also carries a destination account [B10]", async () => {
      await expect(
        service.createTransaction({
          type: "EXPENSE",
          amount: 50,
          date: new Date("2026-03-28"),
          fromAccountId: ACC_A,
          toAccountId: ACC_B,
          userId: USER,
        }),
      ).rejects.toThrow("toAccountId is not allowed");
      expect(acctRepo.incrementBalance).not.toHaveBeenCalled();
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

      await service.updateTransaction(TX_ID, { amount: 175 }, USER);

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
        service.updateTransaction(TX_ID, { type: "INCOME" }, USER),
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
        service.updateTransaction(TX_ID, { amount: 50 }, USER),
      ).rejects.toThrow("Access denied");
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
      expect(txRepo.delete).toHaveBeenCalledWith(TX_ID, "test-session");
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
        "Access denied",
      );
      expect(txRepo.delete).not.toHaveBeenCalled();
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
