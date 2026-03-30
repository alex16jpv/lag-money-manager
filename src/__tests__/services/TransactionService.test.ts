jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "SEQ",
    JWT_SECRET: "test",
    BCRYPT_SALT_ROUNDS: 12,
    JWT_EXPIRATION: "24h",
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  ACCOUNT_TYPES: {
    CASH: "CASH",
    ACCOUNT: "ACCOUNT",
    CARD: "CARD",
    DEBIT_CARD: "DEBIT_CARD",
    SAVINGS: "SAVINGS",
    INVESTMENT: "INVESTMENT",
    OVERDRAFT: "OVERDRAFT",
    LOAN: "LOAN",
    OTHER: "OTHER",
  },
  DB_TYPES: { SEQ: "SEQ", MONGO: "MONGO", LOCAL_STORAGE: "LOCAL_STORAGE" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
  },
  MODEL_NAMES: {
    USER: "User",
    ACCOUNT: "Account",
    TRANSACTION: "Transaction",
    BUDGET: "Budget",
    CATEGORY: "Category",
  },
}));

import { TransactionService } from "../../app/services/TransactionService";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { Transaction } from "../../domain/entities/Transaction";
import { Account } from "../../domain/entities/Account";
import { ApiError } from "../../shared/errors";
import {
  CreateTransactionDTO,
  UpdateTransactionDTO,
} from "../../app/dtos/TransactionDTO";

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
});

const makeAccount = (overrides: Partial<Account> = {}): Account =>
  new Account({
    id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
    name: "Savings",
    type: "SAVINGS",
    balance: 1000,
    userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
    ...overrides,
  });

const validExpense: CreateTransactionDTO = {
  type: "EXPENSE",
  amount: 100,
  date: new Date("2026-03-28"),
  fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
  userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
};

const validIncome: CreateTransactionDTO = {
  type: "INCOME",
  amount: 200,
  date: new Date("2026-03-28"),
  toAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
  userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
};

const validTransfer: CreateTransactionDTO = {
  type: "TRANSFER",
  amount: 150,
  date: new Date("2026-03-28"),
  fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
  toAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
  userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
};

// Stored entities for mock repo returns
const storedExpense = new Transaction({
  id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
  ...validExpense,
});
const storedIncome = new Transaction({
  id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac81",
  ...validIncome,
});
const storedTransfer = new Transaction({
  id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac82",
  ...validTransfer,
});

describe("TransactionService", () => {
  let service: TransactionService;
  let txRepo: jest.Mocked<ITransactionRepository>;
  let acctRepo: jest.Mocked<IAccountRepository>;

  beforeEach(() => {
    txRepo = createMockTransactionRepo();
    acctRepo = createMockAccountRepo();
    service = new TransactionService(txRepo, acctRepo);
  });

  describe("getAllTransactions", () => {
    const pagination = { limit: 20, offset: 0 };

    it("should return all transactions for the user", async () => {
      txRepo.getAllByUserId.mockResolvedValue({
        data: [storedExpense],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const result = await service.getAllTransactions(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        pagination,
      );

      expect(txRepo.getAllByUserId).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        pagination,
      );
      expect(result.data).toHaveLength(1);
    });

    it("should return empty array when none exist", async () => {
      txRepo.getAllByUserId.mockResolvedValue({
        data: [],
        pagination: {
          limit: 20,
          offset: 0,
          total: 0,
          hasMore: false,
          nextCursor: null,
        },
      });

      const result = await service.getAllTransactions(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        pagination,
      );

      expect(result.data).toEqual([]);
    });
  });

  describe("getTransactionById", () => {
    it("should return transaction when found and owned by user", async () => {
      txRepo.getById.mockResolvedValue(storedExpense);

      const result = await service.getTransactionById(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      expect(txRepo.getById).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
      );
      expect(result.type).toBe("EXPENSE");
    });

    it("should throw NotFound when transaction does not exist", async () => {
      txRepo.getById.mockResolvedValue(null);

      await expect(
        service.getTransactionById(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        ),
      ).rejects.toThrow(ApiError);
      await expect(
        service.getTransactionById(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        ),
      ).rejects.toThrow("Transaction not found");
    });
  });

  describe("createTransaction", () => {
    it("should create an expense and subtract from source account", async () => {
      const account = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 1000,
      });
      acctRepo.getById.mockResolvedValue(account);
      txRepo.create.mockResolvedValue(storedExpense);

      const result = await service.createTransaction(validExpense);

      expect(acctRepo.getById).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
      );
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        { balance: 900 },
      );
      expect(txRepo.create).toHaveBeenCalledTimes(1);
      expect(result.type).toBe("EXPENSE");
    });

    it("should create an income and add to destination account", async () => {
      const account = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        balance: 500,
      });
      acctRepo.getById.mockResolvedValue(account);
      txRepo.create.mockResolvedValue(storedIncome);

      const result = await service.createTransaction(validIncome);

      expect(acctRepo.getById).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
      );
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        { balance: 700 },
      );
      expect(result.type).toBe("INCOME");
    });

    it("should create a transfer and update both accounts", async () => {
      const fromAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 1000,
      });
      const toAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        balance: 500,
      });
      acctRepo.getById
        .mockResolvedValueOnce(fromAccount)
        .mockResolvedValueOnce(toAccount);
      txRepo.create.mockResolvedValue(storedTransfer);

      const result = await service.createTransaction(validTransfer);

      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        { balance: 850 },
      );
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        { balance: 650 },
      );
      expect(result.type).toBe("TRANSFER");
    });

    it("should throw when source account not found for expense", async () => {
      acctRepo.getById.mockResolvedValue(null);

      await expect(service.createTransaction(validExpense)).rejects.toThrow(
        "Source account not found",
      );
    });

    it("should throw when destination account not found for income", async () => {
      acctRepo.getById.mockResolvedValue(null);

      await expect(service.createTransaction(validIncome)).rejects.toThrow(
        "Destination account not found",
      );
    });

    it("should throw Forbidden when expense fromAccountId belongs to another user", async () => {
      const otherUserAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 1000,
        userId: "019576a0-d7b6-7d6d-af6a-other-user-00",
      });
      acctRepo.getById.mockResolvedValue(otherUserAccount);

      await expect(service.createTransaction(validExpense)).rejects.toThrow(
        "Source account does not belong to the user",
      );
      await expect(service.createTransaction(validExpense)).rejects.toThrow(
        ApiError,
      );
    });

    it("should throw Forbidden when income toAccountId belongs to another user", async () => {
      const otherUserAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        balance: 500,
        userId: "019576a0-d7b6-7d6d-af6a-other-user-00",
      });
      acctRepo.getById.mockResolvedValue(otherUserAccount);

      await expect(service.createTransaction(validIncome)).rejects.toThrow(
        "Destination account does not belong to the user",
      );
      await expect(service.createTransaction(validIncome)).rejects.toThrow(
        ApiError,
      );
    });

    it("should throw Forbidden when transfer fromAccountId belongs to another user", async () => {
      const otherUserFromAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 1000,
        userId: "019576a0-d7b6-7d6d-af6a-other-user-00",
      });
      acctRepo.getById.mockResolvedValueOnce(otherUserFromAccount);

      await expect(service.createTransaction(validTransfer)).rejects.toThrow(
        "Source account does not belong to the user",
      );
    });

    it("should throw Forbidden when transfer toAccountId belongs to another user", async () => {
      const ownFromAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 1000,
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      });
      const otherUserToAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        balance: 500,
        userId: "019576a0-d7b6-7d6d-af6a-other-user-00",
      });
      acctRepo.getById
        .mockResolvedValueOnce(ownFromAccount)
        .mockResolvedValueOnce(otherUserToAccount);

      await expect(service.createTransaction(validTransfer)).rejects.toThrow(
        "Destination account does not belong to the user",
      );
    });
  });

  describe("updateTransaction", () => {
    it("should reverse old balance and apply new balance on update", async () => {
      const existingTx = new Transaction({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
        type: "EXPENSE",
        amount: 100,
        date: new Date(),
        fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      });
      txRepo.getById.mockResolvedValue(existingTx);

      const account = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 900,
      });
      // First call: reverseBalanceChanges (reads account at 900, restores to 1000)
      // Second call: applyBalanceChanges (reads account at 1000 from mock, subtracts 200)
      acctRepo.getById.mockResolvedValueOnce(account).mockResolvedValueOnce(
        makeAccount({
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
          balance: 1000,
        }),
      );

      const updatedTx = new Transaction({
        ...existingTx,
        amount: 200,
      });
      txRepo.update.mockResolvedValue(updatedTx);

      const result = await service.updateTransaction(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
        { amount: 200 },
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      // Reverse: 900 + 100 = 1000
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        { balance: 1000 },
      );
      // Apply: 1000 - 200 = 800
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        { balance: 800 },
      );
      expect(txRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
        { amount: 200 },
      );
    });

    it("should throw when id in body does not match param id", async () => {
      await expect(
        service.updateTransaction(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac81",
          } as UpdateTransactionDTO,
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        ),
      ).rejects.toThrow(ApiError);
      await expect(
        service.updateTransaction(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac81",
          } as UpdateTransactionDTO,
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        ),
      ).rejects.toThrow("Transaction id does not match");
    });

    it("should throw NotFound when transaction does not exist", async () => {
      txRepo.getById.mockResolvedValue(null);

      await expect(
        service.updateTransaction(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          {
            amount: 50,
          },
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        ),
      ).rejects.toThrow("Transaction not found");
    });

    it("should throw Forbidden when updated fromAccountId belongs to another user", async () => {
      const existingTx = new Transaction({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
        type: "EXPENSE",
        amount: 100,
        date: new Date(),
        fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      });
      txRepo.getById.mockResolvedValue(existingTx);

      const ownAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 900,
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      });
      const otherUserAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac99",
        balance: 500,
        userId: "019576a0-d7b6-7d6d-af6a-other-user-00",
      });
      // First call: reversing old balances (direction=-1, no ownership check)
      // Second call: applying new balances (direction=+1, ownership check triggers)
      acctRepo.getById
        .mockResolvedValueOnce(ownAccount)
        .mockResolvedValueOnce(otherUserAccount);

      await expect(
        service.updateTransaction(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
          { fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac99" },
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        ),
      ).rejects.toThrow("Source account does not belong to the user");
    });
  });

  describe("deleteTransaction", () => {
    it("should reverse balance and delete an expense", async () => {
      txRepo.getById.mockResolvedValue(storedExpense);
      const account = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 900,
      });
      acctRepo.getById.mockResolvedValue(account);
      txRepo.delete.mockResolvedValue();

      await service.deleteTransaction(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      // Reverse: 900 + 100 = 1000
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        { balance: 1000 },
      );
      expect(txRepo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
      );
    });

    it("should reverse balance and delete an income", async () => {
      txRepo.getById.mockResolvedValue(storedIncome);
      const account = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        balance: 700,
      });
      acctRepo.getById.mockResolvedValue(account);
      txRepo.delete.mockResolvedValue();

      await service.deleteTransaction(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac81",
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      // Reverse: 700 - 200 = 500
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        { balance: 500 },
      );
      expect(txRepo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac81",
      );
    });

    it("should reverse balance on both accounts for transfer delete", async () => {
      txRepo.getById.mockResolvedValue(storedTransfer);
      const fromAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 850,
      });
      const toAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        balance: 650,
      });
      acctRepo.getById
        .mockResolvedValueOnce(fromAccount)
        .mockResolvedValueOnce(toAccount);
      txRepo.delete.mockResolvedValue();

      await service.deleteTransaction(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac82",
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      // Reverse from: 850 + 150 = 1000
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        { balance: 1000 },
      );
      // Reverse to: 650 - 150 = 500
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        { balance: 500 },
      );
      expect(txRepo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac82",
      );
    });

    it("should throw NotFound when transaction does not exist", async () => {
      txRepo.getById.mockResolvedValue(null);

      await expect(
        service.deleteTransaction(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        ),
      ).rejects.toThrow(ApiError);
      await expect(
        service.deleteTransaction(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        ),
      ).rejects.toThrow("Transaction not found");
    });

    it("should gracefully handle deleted account on reverse", async () => {
      txRepo.getById.mockResolvedValue(storedExpense);
      acctRepo.getById.mockResolvedValue(null);
      txRepo.delete.mockResolvedValue();

      await service.deleteTransaction(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      expect(acctRepo.update).not.toHaveBeenCalled();
      expect(txRepo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
      );
    });
  });

  describe("error propagation", () => {
    it("should propagate repository error on getAllByUserId failure", async () => {
      txRepo.getAllByUserId.mockRejectedValue(new Error("DB connection lost"));

      await expect(
        service.getAllTransactions("019576a0-d7b6-7d6d-af6a-2b7545f5ac70", {
          limit: 20,
          offset: 0,
        }),
      ).rejects.toThrow("DB connection lost");
    });

    it("should propagate repository error on create failure", async () => {
      const account = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 1000,
      });
      acctRepo.getById.mockResolvedValue(account);
      txRepo.create.mockRejectedValue(new Error("DB write failed"));

      await expect(service.createTransaction(validExpense)).rejects.toThrow(
        "DB write failed",
      );
    });

    it("should propagate repository error on delete failure", async () => {
      txRepo.getById.mockResolvedValue(storedExpense);
      const account = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 900,
      });
      acctRepo.getById.mockResolvedValue(account);
      txRepo.delete.mockRejectedValue(new Error("DB delete failed"));

      await expect(
        service.deleteTransaction(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        ),
      ).rejects.toThrow("DB delete failed");
    });
  });

  describe("balance adjustment edge cases", () => {
    it("should handle floating-point amounts correctly", async () => {
      const dto: CreateTransactionDTO = {
        type: "EXPENSE",
        amount: 0.1,
        date: new Date("2026-03-28"),
        fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      };
      const account = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 0.2,
      });
      acctRepo.getById.mockResolvedValue(account);
      txRepo.create.mockResolvedValue(new Transaction({ id: "tx-id", ...dto }));

      await service.createTransaction(dto);

      const updateCall = acctRepo.update.mock.calls[0][1];
      expect(typeof updateCall.balance).toBe("number");
      expect(updateCall.balance).toBeCloseTo(0.1, 10);
    });

    it("should allow balance to go negative", async () => {
      const dto: CreateTransactionDTO = {
        type: "EXPENSE",
        amount: 500,
        date: new Date("2026-03-28"),
        fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      };
      const account = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        balance: 100,
      });
      acctRepo.getById.mockResolvedValue(account);
      txRepo.create.mockResolvedValue(new Transaction({ id: "tx-id", ...dto }));

      await service.createTransaction(dto);

      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        { balance: -400 },
      );
    });

    it("should skip account not found during reversal (direction === -1)", async () => {
      const expense = new Transaction({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
        type: "EXPENSE",
        amount: 100,
        date: new Date(),
        fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      });
      txRepo.getById.mockResolvedValue(expense);
      // Account deleted — getById returns null for both reversal and new balance
      acctRepo.getById.mockResolvedValue(null);

      const newFromAccount = makeAccount({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac99",
        balance: 2000,
      });
      // Second adjustBalances call (direction=1) for new account
      acctRepo.getById
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newFromAccount);
      txRepo.update.mockResolvedValue(
        new Transaction({
          ...expense,
          fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac99",
          amount: 100,
        }),
      );

      await service.updateTransaction(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
        { fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac99" },
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );

      // The first adjustBalances (reversal) should not update since account not found
      // The second adjustBalances (apply) should update the new account
      expect(acctRepo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac99",
        { balance: 1900 },
      );
    });
  });
});
