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
    RED: "RED",
    ORANGE: "ORANGE",
    AMBER: "AMBER",
    YELLOW: "YELLOW",
    LIME: "LIME",
    GREEN: "GREEN",
    TEAL: "TEAL",
    CYAN: "CYAN",
    BLUE: "BLUE",
    INDIGO: "INDIGO",
    PURPLE: "PURPLE",
    PINK: "PINK",
    ROSE: "ROSE",
    GRAY: "GRAY",
    BROWN: "BROWN",
    BLACK: "BLACK",
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

import { Account } from "../../domain/entities/Account";

describe("Account Entity", () => {
  const validProps = {
    id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
    name: "Savings Account",
    type: "SAVINGS" as const,
    balance: 1000,
    userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
  };

  describe("constructor", () => {
    it("should create an account with all properties", () => {
      const account = new Account(validProps);

      expect(account.id).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac70");
      expect(account.name).toBe("Savings Account");
      expect(account.type).toBe("SAVINGS");
      expect(account.balance).toBe(1000);
      expect(account.userId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac71");
    });

    it("should default balance to 0 when not provided", () => {
      const account = new Account({
        ...validProps,
        balance: undefined as unknown as number,
      });

      expect(account.balance).toBe(0);
    });

    it("should keep balance 0 when explicitly set to 0", () => {
      const account = new Account({ ...validProps, balance: 0 });

      expect(account.balance).toBe(0);
    });

    it("should create an account with color", () => {
      const account = new Account({ ...validProps, color: "BLUE" });

      expect(account.color).toBe("BLUE");
    });

    it("should create an account without color", () => {
      const account = new Account(validProps);

      expect(account.color).toBeUndefined();
    });
  });
});
