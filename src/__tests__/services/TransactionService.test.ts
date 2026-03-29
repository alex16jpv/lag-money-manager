jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: { PORT: 3000, DB_TYPE: "SEQ", JWT_SECRET: "test" },
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
import { DomainValidationError } from "../../domain/errors";
import {
  CreateTransactionDTO,
  UpdateTransactionDTO,
} from "../../app/dtos/TransactionDTO";

const createMockTransactionRepo = (): jest.Mocked<ITransactionRepository> => ({
  getAll: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

const createMockAccountRepo = (): jest.Mocked<IAccountRepository> => ({
  getAll: jest.fn(),
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
    it("should return all transactions", async () => {
      txRepo.getAll.mockResolvedValue([storedExpense]);

      const result = await service.getAllTransactions();

      expect(txRepo.getAll).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });

    it("should return empty array when none exist", async () => {
      txRepo.getAll.mockResolvedValue([]);

      const result = await service.getAllTransactions();

      expect(result).toEqual([]);
    });
  });

  describe("getTransactionById", () => {
    it("should return transaction when found", async () => {
      txRepo.getById.mockResolvedValue(storedExpense);

      const result = await service.getTransactionById(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
      );

      expect(txRepo.getById).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
      );
      expect(result.type).toBe("EXPENSE");
    });

    it("should throw NotFound when transaction does not exist", async () => {
      txRepo.getById.mockResolvedValue(null);

      await expect(
        service.getTransactionById("019576a0-d7b6-7d6d-af6a-000000000000"),
      ).rejects.toThrow(ApiError);
      await expect(
        service.getTransactionById("019576a0-d7b6-7d6d-af6a-000000000000"),
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

    it("should throw when validation fails", async () => {
      const invalid: CreateTransactionDTO = {
        type: "EXPENSE",
        amount: -10,
        date: new Date(),
        fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      };

      await expect(service.createTransaction(invalid)).rejects.toThrow(
        DomainValidationError,
      );
      expect(txRepo.create).not.toHaveBeenCalled();
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
      acctRepo.getById
        .mockResolvedValueOnce(account)
        .mockResolvedValueOnce(
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
        service.updateTransaction("019576a0-d7b6-7d6d-af6a-2b7545f5ac80", {
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac81",
        } as UpdateTransactionDTO),
      ).rejects.toThrow(ApiError);
      await expect(
        service.updateTransaction("019576a0-d7b6-7d6d-af6a-2b7545f5ac80", {
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac81",
        } as UpdateTransactionDTO),
      ).rejects.toThrow("Transaction id does not match");
    });

    it("should throw NotFound when transaction does not exist", async () => {
      txRepo.getById.mockResolvedValue(null);

      await expect(
        service.updateTransaction("019576a0-d7b6-7d6d-af6a-000000000000", {
          amount: 50,
        }),
      ).rejects.toThrow("Transaction not found");
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

      await service.deleteTransaction("019576a0-d7b6-7d6d-af6a-2b7545f5ac80");

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

      await service.deleteTransaction("019576a0-d7b6-7d6d-af6a-2b7545f5ac81");

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

      await service.deleteTransaction("019576a0-d7b6-7d6d-af6a-2b7545f5ac82");

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
        service.deleteTransaction("019576a0-d7b6-7d6d-af6a-000000000000"),
      ).rejects.toThrow(ApiError);
      await expect(
        service.deleteTransaction("019576a0-d7b6-7d6d-af6a-000000000000"),
      ).rejects.toThrow("Transaction not found");
    });

    it("should gracefully handle deleted account on reverse", async () => {
      txRepo.getById.mockResolvedValue(storedExpense);
      acctRepo.getById.mockResolvedValue(null);
      txRepo.delete.mockResolvedValue();

      await service.deleteTransaction("019576a0-d7b6-7d6d-af6a-2b7545f5ac80");

      expect(acctRepo.update).not.toHaveBeenCalled();
      expect(txRepo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac80",
      );
    });
  });
});
