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

import { Transaction } from "../../domain/entities/Transaction";
import { DomainValidationError } from "../../domain/errors";

describe("Transaction Entity", () => {
  const validExpenseProps = {
    id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
    type: "EXPENSE" as const,
    amount: 50,
    date: new Date("2026-03-28"),
    categoryId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac73",
    description: "Groceries",
    fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
    toAccountId: null,
    userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac74",
    tags: "food",
    note: "Weekly shopping",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const validIncomeProps = {
    ...validExpenseProps,
    type: "INCOME" as const,
    fromAccountId: null,
    toAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
  };

  const validTransferProps = {
    ...validExpenseProps,
    type: "TRANSFER" as const,
    fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
    toAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
  };

  describe("constructor", () => {
    it("should create a transaction with all properties", () => {
      const tx = new Transaction(validExpenseProps);

      expect(tx.id).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac70");
      expect(tx.type).toBe("EXPENSE");
      expect(tx.amount).toBe(50);
      expect(tx.date).toBeInstanceOf(Date);
      expect(tx.categoryId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac73");
      expect(tx.description).toBe("Groceries");
      expect(tx.fromAccountId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac71");
      expect(tx.toAccountId).toBeNull();
      expect(tx.userId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac74");
      expect(tx.tags).toBe("food");
      expect(tx.note).toBe("Weekly shopping");
    });

    it("should default optional fields to null", () => {
      const tx = new Transaction({
        type: "EXPENSE",
        amount: 10,
        date: new Date(),
        fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac74",
      });

      expect(tx.categoryId).toBeNull();
      expect(tx.description).toBeNull();
      expect(tx.toAccountId).toBeNull();
      expect(tx.tags).toBeNull();
      expect(tx.note).toBeNull();
    });

    it("should parse string date into Date object", () => {
      const tx = new Transaction({
        ...validExpenseProps,
        date: "2026-03-28T12:00:00.000Z",
      });

      expect(tx.date).toBeInstanceOf(Date);
    });
  });

  describe("validate", () => {
    it("should not throw for a valid expense", () => {
      const tx = new Transaction(validExpenseProps);
      expect(() => tx.validate()).not.toThrow();
    });

    it("should not throw for a valid income", () => {
      const tx = new Transaction(validIncomeProps);
      expect(() => tx.validate()).not.toThrow();
    });

    it("should not throw for a valid transfer", () => {
      const tx = new Transaction(validTransferProps);
      expect(() => tx.validate()).not.toThrow();
    });

    it("should throw when type is missing", () => {
      const tx = new Transaction({
        ...validExpenseProps,
        type: "" as "EXPENSE",
      });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow("'type' is required");
    });

    it("should throw for invalid transaction type", () => {
      const tx = new Transaction({
        ...validExpenseProps,
        type: "INVALID" as "EXPENSE",
      });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow("Invalid transaction type");
    });

    it("should throw when amount is 0", () => {
      const tx = new Transaction({ ...validExpenseProps, amount: 0 });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow("'amount' must be greater than 0");
    });

    it("should throw when amount is negative", () => {
      const tx = new Transaction({ ...validExpenseProps, amount: -10 });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow("'amount' must be greater than 0");
    });

    it("should throw when userId is missing", () => {
      const tx = new Transaction({
        ...validExpenseProps,
        userId: "" as unknown as string,
      });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow("'userId' is required");
    });

    it("should throw when expense has no fromAccountId", () => {
      const tx = new Transaction({
        ...validExpenseProps,
        fromAccountId: null,
      });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow(
        "'fromAccountId' is required for expense transactions",
      );
    });

    it("should throw when income has no toAccountId", () => {
      const tx = new Transaction({
        ...validIncomeProps,
        toAccountId: null,
      });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow(
        "'toAccountId' is required for income transactions",
      );
    });

    it("should throw when transfer has no fromAccountId", () => {
      const tx = new Transaction({
        ...validTransferProps,
        fromAccountId: null,
      });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow(
        "'fromAccountId' is required for transfer transactions",
      );
    });

    it("should throw when transfer has no toAccountId", () => {
      const tx = new Transaction({
        ...validTransferProps,
        toAccountId: null,
      });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow(
        "'toAccountId' is required for transfer transactions",
      );
    });

    it("should throw when transfer has same from and to account", () => {
      const tx = new Transaction({
        ...validTransferProps,
        fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        toAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
      });
      expect(() => tx.validate()).toThrow(DomainValidationError);
      expect(() => tx.validate()).toThrow(
        "'fromAccountId' and 'toAccountId' must be different",
      );
    });
  });
});
