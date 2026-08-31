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
    ADJUSTMENT: "ADJUSTMENT",
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
    tags: ["food"],
    note: "Weekly shopping",
    createdAt: new Date(),
    updatedAt: new Date(),
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
      expect(tx.tags).toEqual(["food"]);
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
      expect(tx.tags).toEqual([]);
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

  describe("assertValid — ADJUSTMENT [R2-06]", () => {
    const base = {
      amount: 25,
      date: new Date("2026-08-31"),
      userId: validExpenseProps.userId,
    };

    it("accepts a decrease (fromAccountId only)", () => {
      const tx = new Transaction({
        ...base,
        type: "ADJUSTMENT",
        fromAccountId: validExpenseProps.fromAccountId,
      });
      expect(() => tx.assertValid()).not.toThrow();
    });

    it("accepts an increase (toAccountId only)", () => {
      const tx = new Transaction({
        ...base,
        type: "ADJUSTMENT",
        toAccountId: validExpenseProps.fromAccountId,
      });
      expect(() => tx.assertValid()).not.toThrow();
    });

    it("rejects both account sides", () => {
      const tx = new Transaction({
        ...base,
        type: "ADJUSTMENT",
        fromAccountId: validExpenseProps.fromAccountId,
        toAccountId: validExpenseProps.categoryId,
      });
      expect(() => tx.assertValid()).toThrow("exactly one");
    });

    it("rejects no account side", () => {
      const tx = new Transaction({ ...base, type: "ADJUSTMENT" });
      expect(() => tx.assertValid()).toThrow("exactly one");
    });

    it("rejects a category", () => {
      const tx = new Transaction({
        ...base,
        type: "ADJUSTMENT",
        fromAccountId: validExpenseProps.fromAccountId,
        categoryId: validExpenseProps.categoryId,
      });
      expect(() => tx.assertValid()).toThrow(
        "categoryId is not allowed for adjustment",
      );
    });
  });

  describe("assertValid — future dates [R2-30]", () => {
    it("rejects a date more than 24h in the future", () => {
      const tx = new Transaction({
        ...validExpenseProps,
        date: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });
      expect(() => tx.assertValid()).toThrow("24 hours in the future");
    });

    it("accepts today and the timezone margin", () => {
      const tx = new Transaction({
        ...validExpenseProps,
        date: new Date(Date.now() + 12 * 60 * 60 * 1000),
      });
      expect(() => tx.assertValid()).not.toThrow();
    });
  });
});
