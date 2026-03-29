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

import { Account } from "../../domain/entities/Account";
import { DomainValidationError } from "../../domain/errors";

describe("Account Entity", () => {
  const validProps = {
    id: 1,
    name: "Savings Account",
    type: "SAVINGS" as const,
    balance: 1000,
    userId: 1,
  };

  describe("constructor", () => {
    it("should create an account with all properties", () => {
      const account = new Account(validProps);

      expect(account.id).toBe(1);
      expect(account.name).toBe("Savings Account");
      expect(account.type).toBe("SAVINGS");
      expect(account.balance).toBe(1000);
      expect(account.userId).toBe(1);
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
  });

  describe("validate", () => {
    it("should not throw for a valid account", () => {
      const account = new Account(validProps);
      expect(() => account.validate()).not.toThrow();
    });

    it("should throw DomainValidationError when userId is missing", () => {
      const account = new Account({
        ...validProps,
        userId: 0 as unknown as number,
      });

      expect(() => account.validate()).toThrow(DomainValidationError);
      expect(() => account.validate()).toThrow("'userId' is required");
    });

    it("should throw DomainValidationError when name is missing", () => {
      const account = new Account({
        ...validProps,
        name: "" as unknown as string,
      });

      expect(() => account.validate()).toThrow(DomainValidationError);
      expect(() => account.validate()).toThrow("'name' is required");
    });

    it("should throw DomainValidationError when type is missing", () => {
      const account = new Account({
        ...validProps,
        type: "" as unknown as typeof validProps.type,
      });

      expect(() => account.validate()).toThrow(DomainValidationError);
      expect(() => account.validate()).toThrow("'type' is required");
    });

    it("should throw DomainValidationError for invalid account type", () => {
      const account = new Account({
        ...validProps,
        type: "INVALID" as unknown as typeof validProps.type,
      });

      expect(() => account.validate()).toThrow(DomainValidationError);
      expect(() => account.validate()).toThrow("Invalid account type");
    });
  });
});
