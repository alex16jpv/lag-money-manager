jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "SEQ",
    JWT_SECRET: "test",
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
  COLORS: {
    RED: "RED", ORANGE: "ORANGE", AMBER: "AMBER", YELLOW: "YELLOW",
    LIME: "LIME", GREEN: "GREEN", TEAL: "TEAL", CYAN: "CYAN",
    BLUE: "BLUE", INDIGO: "INDIGO", PURPLE: "PURPLE", PINK: "PINK",
    ROSE: "ROSE", GRAY: "GRAY", BROWN: "BROWN", BLACK: "BLACK",
  },
  DB_TYPES: { SEQ: "SEQ", MONGO: "MONGO", LOCAL_STORAGE: "LOCAL_STORAGE" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
  },
  CATEGORY_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
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
});
