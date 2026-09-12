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
  DB_TYPES: { MONGO: "MONGO" },
  TRANSACTION_SOURCES: { MANUAL: "MANUAL", QUICK: "QUICK", IMPORT: "IMPORT" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
    ADJUSTMENT: "ADJUSTMENT",
  },
  BUDGET_TYPES: { EXPENSE: "EXPENSE", INCOME: "INCOME" },
  SPENDING_GROUP_BY: {
    category: "category",
    day: "day",
    month: "month",
    account: "account",
    tag: "tag",
  },
  SPENDING_SPLIT_BY: { category: "category" },
  MAX_BUDGET_CATEGORIES: 20,
  BUDGET_PERIOD_TYPES: {
    WEEKLY: "WEEKLY",
    BIWEEKLY: "BIWEEKLY",
    MONTHLY: "MONTHLY",
    QUARTERLY: "QUARTERLY",
    YEARLY: "YEARLY",
    CUSTOM: "CUSTOM",
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

import {
  createAccountSchema,
  createBudgetSchema,
  createCategorySchema,
  createTransactionSchema,
  getCategoriesSchema,
  getTransactionsSchema,
  idParamSchema,
  loginSchema,
  paginationQuerySchema,
  quickAddTransactionSchema,
  registerSchema,
  spendingStatsSchema,
  syncBatchSchema,
  updateAccountSchema,
  updateCategorySchema,
  updateTransactionSchema,
  updateUserSchema,
} from "../../app/validation/schemas";

const validUUID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const validUUID2 = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";

describe("Validation Schemas", () => {
  describe("paginationQuerySchema", () => {
    it("should accept valid pagination params", () => {
      const result = paginationQuerySchema.safeParse({
        query: { limit: "10", offset: "0" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept empty query (all optional)", () => {
      const result = paginationQuerySchema.safeParse({ query: {} });
      expect(result.success).toBe(true);
    });

    it("should accept valid cursor UUID", () => {
      const result = paginationQuerySchema.safeParse({
        query: { cursor: validUUID },
      });
      expect(result.success).toBe(true);
    });

    it("should reject non-integer limit", () => {
      const result = paginationQuerySchema.safeParse({
        query: { limit: "1.5" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject limit below 1", () => {
      const result = paginationQuerySchema.safeParse({
        query: { limit: "0" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject limit above MAX_LIMIT", () => {
      const result = paginationQuerySchema.safeParse({
        query: { limit: "101" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject negative offset", () => {
      const result = paginationQuerySchema.safeParse({
        query: { offset: "-1" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid cursor format", () => {
      const result = paginationQuerySchema.safeParse({
        query: { cursor: "not-a-uuid" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid comma-separated ids", () => {
      const result = paginationQuerySchema.safeParse({
        query: { ids: `${validUUID},${validUUID2}` },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.ids).toEqual([validUUID, validUUID2]);
      }
    });

    it("should accept a single id", () => {
      const result = paginationQuerySchema.safeParse({
        query: { ids: validUUID },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query.ids).toEqual([validUUID]);
      }
    });

    it("should reject invalid UUID in ids", () => {
      const result = paginationQuerySchema.safeParse({
        query: { ids: `${validUUID},not-a-uuid` },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("registerSchema", () => {
    const validRegister = {
      body: {
        name: "John Doe",
        email: "john@example.com",
        password: "password123",
      },
    };

    it("should accept a supported locale", () => {
      const result = registerSchema.safeParse({
        body: { ...validRegister.body, locale: "es" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject an unsupported locale", () => {
      const result = registerSchema.safeParse({
        body: { ...validRegister.body, locale: "fr" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid registration data", () => {
      const result = registerSchema.safeParse(validRegister);
      expect(result.success).toBe(true);
    });

    it("should reject empty name", () => {
      const result = registerSchema.safeParse({
        body: { ...validRegister.body, name: "" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject name exceeding 255 characters", () => {
      const result = registerSchema.safeParse({
        body: { ...validRegister.body, name: "a".repeat(256) },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid email format", () => {
      const result = registerSchema.safeParse({
        body: { ...validRegister.body, email: "not-an-email" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject email exceeding 255 characters", () => {
      const result = registerSchema.safeParse({
        body: {
          ...validRegister.body,
          email: "a".repeat(250) + "@test.com",
        },
      });
      expect(result.success).toBe(false);
    });

    it("should reject password shorter than 8 characters", () => {
      const result = registerSchema.safeParse({
        body: { ...validRegister.body, password: "short" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject password exceeding 128 characters", () => {
      const result = registerSchema.safeParse({
        body: { ...validRegister.body, password: "a".repeat(129) },
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const result = registerSchema.safeParse({ body: {} });
      expect(result.success).toBe(false);
    });
  });

  describe("loginSchema", () => {
    it("should accept valid login data", () => {
      const result = loginSchema.safeParse({
        body: { email: "john@example.com", password: "password123" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid email", () => {
      const result = loginSchema.safeParse({
        body: { email: "invalid", password: "password123" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty password", () => {
      const result = loginSchema.safeParse({
        body: { email: "john@example.com", password: "" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateUserSchema", () => {
    it("should accept valid update with name", () => {
      const result = updateUserSchema.safeParse({
        params: { id: validUUID },
        body: { name: "New Name" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid update with email", () => {
      const result = updateUserSchema.safeParse({
        params: { id: validUUID },
        body: { email: "new@example.com", currentPassword: "oldpassword" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid update with password", () => {
      const result = updateUserSchema.safeParse({
        params: { id: validUUID },
        body: { password: "newpassword123", currentPassword: "oldpassword" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty body (no fields provided)", () => {
      const result = updateUserSchema.safeParse({
        params: { id: validUUID },
        body: {},
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid UUID in params", () => {
      const result = updateUserSchema.safeParse({
        params: { id: "not-a-uuid" },
        body: { name: "Test" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject short password", () => {
      const result = updateUserSchema.safeParse({
        params: { id: validUUID },
        body: { password: "short" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("idParamSchema", () => {
    it("should accept valid UUID", () => {
      const result = idParamSchema.safeParse({ params: { id: validUUID } });
      expect(result.success).toBe(true);
    });

    it("should reject invalid UUID", () => {
      const result = idParamSchema.safeParse({
        params: { id: "not-a-uuid" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty string", () => {
      const result = idParamSchema.safeParse({ params: { id: "" } });
      expect(result.success).toBe(false);
    });
  });

  describe("createAccountSchema", () => {
    it("should accept valid account data", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "Savings", type: "SAVINGS", balance: 1000 },
      });
      expect(result.success).toBe(true);
    });

    it("should default balance to 0", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "Savings", type: "SAVINGS" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.body.balance).toBe(0);
      }
    });

    it("should reject empty name", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "", type: "SAVINGS" },
      });
      expect(result.success).toBe(false);
    });

    // The unique index folds case and accents but not whitespace, so "Savings " would slip past.
    it("trims the name so padding cannot bypass the unique index", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "  Savings  ", type: "SAVINGS" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.body.name).toBe("Savings");
      }
    });

    it("should reject a name that is only whitespace", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "   ", type: "SAVINGS" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject name exceeding 255 characters", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "a".repeat(256), type: "SAVINGS" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid account type", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "Test", type: "INVALID" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept all valid account types", () => {
      const types = [
        "CASH",
        "ACCOUNT",
        "CARD",
        "DEBIT_CARD",
        "SAVINGS",
        "INVESTMENT",
        "OVERDRAFT",
        "LOAN",
        "OTHER",
      ];
      for (const type of types) {
        const result = createAccountSchema.safeParse({
          body: { name: "Test", type },
        });
        expect(result.success).toBe(true);
      }
    });

    it("should reject non-finite balance", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "Test", type: "CASH", balance: Infinity },
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid color", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "Test", type: "CASH", color: "BLUE" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid color", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "Test", type: "CASH", color: "RAINBOW" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept account without color", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "Test", type: "CASH" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("updateAccountSchema", () => {
    it("should accept valid update with name", () => {
      const result = updateAccountSchema.safeParse({
        params: { id: validUUID },
        body: { name: "Updated" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid update with type", () => {
      const result = updateAccountSchema.safeParse({
        params: { id: validUUID },
        body: { type: "CARD" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty body", () => {
      const result = updateAccountSchema.safeParse({
        params: { id: validUUID },
        body: {},
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid account type", () => {
      const result = updateAccountSchema.safeParse({
        params: { id: validUUID },
        body: { type: "INVALID" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid color update", () => {
      const result = updateAccountSchema.safeParse({
        params: { id: validUUID },
        body: { color: "RED" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept null color to clear it", () => {
      const result = updateAccountSchema.safeParse({
        params: { id: validUUID },
        body: { color: null },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("getCategoriesSchema", () => {
    it("should accept empty query (all optional)", () => {
      const result = getCategoriesSchema.safeParse({ query: {} });
      expect(result.success).toBe(true);
    });

    it("should accept valid type filter INCOME", () => {
      const result = getCategoriesSchema.safeParse({
        query: { type: "INCOME" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid type filter EXPENSE", () => {
      const result = getCategoriesSchema.safeParse({
        query: { type: "EXPENSE" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid type filter", () => {
      const result = getCategoriesSchema.safeParse({
        query: { type: "INVALID_TYPE" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept type with pagination", () => {
      const result = getCategoriesSchema.safeParse({
        query: { type: "EXPENSE", limit: "10", offset: "0" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("createCategorySchema", () => {
    it("should accept valid category", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept a curated icon key", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food", icon: "utensils" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject an icon outside the curated set", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food", icon: "not-an-icon" },
      });
      expect(result.success).toBe(false);
    });

    it("should drop the legacy emoji field instead of storing it", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food", emoji: "x" },
      });
      expect(result.success).toBe(true);
      const body = (result.data as { body: Record<string, unknown> }).body;
      expect(body).not.toHaveProperty("emoji");
    });

    it("should reject empty name", () => {
      const result = createCategorySchema.safeParse({ body: { name: "" } });
      expect(result.success).toBe(false);
    });

    it("should reject name exceeding 255 characters", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "a".repeat(256) },
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid color", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food", color: "GREEN" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid color", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food", color: "RAINBOW" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid category type", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Salary", type: "INCOME" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept EXPENSE category type", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food", type: "EXPENSE" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid category type", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food", type: "INVALID_TYPE" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept category without color and type", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("updateCategorySchema", () => {
    it("should accept valid update", () => {
      const result = updateCategorySchema.safeParse({
        params: { id: validUUID },
        body: { name: "Transport" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept update with only icon", () => {
      const result = updateCategorySchema.safeParse({
        params: { id: validUUID },
        body: { icon: "car" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept update clearing the icon with null", () => {
      const result = updateCategorySchema.safeParse({
        params: { id: validUUID },
        body: { icon: null },
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty body (no name or icon)", () => {
      const result = updateCategorySchema.safeParse({
        params: { id: validUUID },
        body: {},
      });
      expect(result.success).toBe(false);
    });

    it("should accept update with color", () => {
      const result = updateCategorySchema.safeParse({
        params: { id: validUUID },
        body: { color: "PURPLE" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept update with type", () => {
      const result = updateCategorySchema.safeParse({
        params: { id: validUUID },
        body: { type: "INCOME" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept null color to clear it", () => {
      const result = updateCategorySchema.safeParse({
        params: { id: validUUID },
        body: { color: null },
      });
      expect(result.success).toBe(true);
    });

    it("should accept null type to clear it", () => {
      const result = updateCategorySchema.safeParse({
        params: { id: validUUID },
        body: { type: null },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("createTransactionSchema", () => {
    const validDate = "2026-03-28T12:00:00.000Z";

    describe("EXPENSE type", () => {
      it("should accept valid expense with fromAccountId", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: validDate,
            fromAccountId: validUUID,
          },
        });
        expect(result.success).toBe(true);
      });

      it("should reject expense without fromAccountId", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: validDate,
          },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages).toContain(
            "fromAccountId is required for expense transactions",
          );
        }
      });
    });

    describe("INCOME type", () => {
      it("should accept valid income with toAccountId", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "INCOME",
            amount: 100,
            date: validDate,
            toAccountId: validUUID,
          },
        });
        expect(result.success).toBe(true);
      });

      it("should reject income without toAccountId", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "INCOME",
            amount: 100,
            date: validDate,
          },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages).toContain(
            "toAccountId is required for income transactions",
          );
        }
      });
    });

    describe("TRANSFER type", () => {
      it("should accept valid transfer with both account IDs", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "TRANSFER",
            amount: 150,
            date: validDate,
            fromAccountId: validUUID,
            toAccountId: validUUID2,
          },
        });
        expect(result.success).toBe(true);
      });

      it("should reject transfer without fromAccountId", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "TRANSFER",
            amount: 150,
            date: validDate,
            toAccountId: validUUID2,
          },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages).toContain(
            "fromAccountId is required for transfer transactions",
          );
        }
      });

      it("should reject transfer without toAccountId", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "TRANSFER",
            amount: 150,
            date: validDate,
            fromAccountId: validUUID,
          },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages).toContain(
            "toAccountId is required for transfer transactions",
          );
        }
      });

      it("should reject transfer with same fromAccountId and toAccountId", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "TRANSFER",
            amount: 150,
            date: validDate,
            fromAccountId: validUUID,
            toAccountId: validUUID,
          },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages).toContain(
            "fromAccountId and toAccountId must be different",
          );
        }
      });

      it("should reject transfer missing both account IDs", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "TRANSFER",
            amount: 150,
            date: validDate,
          },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages).toContain(
            "fromAccountId is required for transfer transactions",
          );
          expect(messages).toContain(
            "toAccountId is required for transfer transactions",
          );
        }
      });
    });

    describe("common fields", () => {
      it("should reject zero amount", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 0,
            date: validDate,
            fromAccountId: validUUID,
          },
        });
        expect(result.success).toBe(false);
      });

      it("should reject negative amount", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: -10,
            date: validDate,
            fromAccountId: validUUID,
          },
        });
        expect(result.success).toBe(false);
      });

      it("should reject invalid date format", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: "not-a-date",
            fromAccountId: validUUID,
          },
        });
        expect(result.success).toBe(false);
      });

      it("should reject invalid transaction type", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "INVALID",
            amount: 50,
            date: validDate,
            fromAccountId: validUUID,
          },
        });
        expect(result.success).toBe(false);
      });

      it("should reject invalid UUID for fromAccountId", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: validDate,
            fromAccountId: "not-a-uuid",
          },
        });
        expect(result.success).toBe(false);
      });

      it("should reject invalid UUID for categoryId", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: validDate,
            fromAccountId: validUUID,
            categoryId: "not-a-uuid",
          },
        });
        expect(result.success).toBe(false);
      });

      it("should accept nullable optional fields", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: validDate,
            fromAccountId: validUUID,
            categoryId: null,
            description: null,
            note: null,
          },
        });
        expect(result.success).toBe(true);
      });

      it("should reject description exceeding 255 characters", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: validDate,
            fromAccountId: validUUID,
            description: "a".repeat(256),
          },
        });
        expect(result.success).toBe(false);
      });

      it("should accept an array of tags", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: validDate,
            fromAccountId: validUUID,
            tags: ["food", "coffee"],
          },
        });
        expect(result.success).toBe(true);
      });

      it("should reject a tag exceeding 50 characters", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: validDate,
            fromAccountId: validUUID,
            tags: ["a".repeat(51)],
          },
        });
        expect(result.success).toBe(false);
      });

      it("should reject note exceeding 1000 characters", () => {
        const result = createTransactionSchema.safeParse({
          body: {
            type: "EXPENSE",
            amount: 50,
            date: validDate,
            fromAccountId: validUUID,
            note: "a".repeat(1001),
          },
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("updateTransactionSchema", () => {
    it("should accept valid partial update", () => {
      const result = updateTransactionSchema.safeParse({
        params: { id: validUUID },
        body: { amount: 200 },
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty body", () => {
      const result = updateTransactionSchema.safeParse({
        params: { id: validUUID },
        body: {},
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid UUID in params", () => {
      const result = updateTransactionSchema.safeParse({
        params: { id: "not-a-uuid" },
        body: { amount: 200 },
      });
      expect(result.success).toBe(false);
    });

    it("should reject negative amount", () => {
      const result = updateTransactionSchema.safeParse({
        params: { id: validUUID },
        body: { amount: -10 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("getTransactionsSchema", () => {
    it("should accept empty query (all optional)", () => {
      const result = getTransactionsSchema.safeParse({ query: {} });
      expect(result.success).toBe(true);
    });

    it("should accept valid pagination params only", () => {
      const result = getTransactionsSchema.safeParse({
        query: { limit: "10", offset: "0" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid accountId filter", () => {
      const result = getTransactionsSchema.safeParse({
        query: { accountId: validUUID },
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid type filter", () => {
      const result = getTransactionsSchema.safeParse({
        query: { type: "EXPENSE" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept all valid transaction types as filter", () => {
      for (const type of ["INCOME", "EXPENSE", "TRANSFER"]) {
        const result = getTransactionsSchema.safeParse({
          query: { type },
        });
        expect(result.success).toBe(true);
      }
    });

    it("should accept both filters combined with pagination", () => {
      const result = getTransactionsSchema.safeParse({
        query: {
          limit: "10",
          offset: "0",
          accountId: validUUID,
          type: "INCOME",
        },
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid accountId UUID", () => {
      const result = getTransactionsSchema.safeParse({
        query: { accountId: "not-a-uuid" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid transaction type", () => {
      const result = getTransactionsSchema.safeParse({
        query: { type: "INVALID" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject limit below 1", () => {
      const result = getTransactionsSchema.safeParse({
        query: { limit: "0" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject limit above MAX_LIMIT", () => {
      const result = getTransactionsSchema.safeParse({
        query: { limit: "101" },
      });
      expect(result.success).toBe(false);
    });

    // "The five biggest of the period" cannot be asked for without an order.
    describe("order and several categories", () => {
      it.each([
        ["the default, which is newest first", {}],
        ["biggest first", { sort: "amount", order: "desc" }],
        ["smallest first", { sort: "amount", order: "asc" }],
        ["oldest first", { sort: "date", order: "asc" }],
      ])("accepts %s", (_label, query) => {
        expect(getTransactionsSchema.safeParse({ query }).success).toBe(true);
      });

      it.each([
        ["a field it does not order by", { sort: "description" }],
        ["a direction that is not one", { order: "descending" }],
      ])("rejects %s", (_label, query) => {
        expect(getTransactionsSchema.safeParse({ query }).success).toBe(false);
      });

      it("takes the categories of a budget as one list", () => {
        const result = getTransactionsSchema.safeParse({
          query: { categoryIds: `${validUUID},${validUUID2}` },
        });

        expect(result.success).toBe(true);
        expect(
          (result.data as { query: { categoryIds: string[] } }).query
            .categoryIds,
        ).toEqual([validUUID, validUUID2]);
      });

      it.each([
        ["an id that is not one", { categoryIds: "food,drink" }],
        ["an empty list", { categoryIds: "" }],
        [
          "more than a budget can hold",
          {
            categoryIds: Array.from({ length: 21 }, () => validUUID).join(","),
          },
        ],
        [
          "one category and a list at the same time",
          { categoryId: validUUID, categoryIds: `${validUUID},${validUUID2}` },
        ],
        [
          "a list together with uncategorized",
          { uncategorized: "true", categoryIds: validUUID },
        ],
      ])("rejects %s", (_label, query) => {
        expect(getTransactionsSchema.safeParse({ query }).success).toBe(false);
      });
    });
  });

  // Four views of Stats need a dimension or a filter this endpoint did not have.
  describe("spendingStatsSchema", () => {
    it.each(["category", "day", "month", "account", "tag"])(
      "groups by %s",
      (groupBy) => {
        expect(
          spendingStatsSchema.safeParse({ query: { groupBy } }).success,
        ).toBe(true);
      },
    );

    it("rejects a dimension it cannot group by", () => {
      expect(
        spendingStatsSchema.safeParse({ query: { groupBy: "description" } })
          .success,
      ).toBe(false);
    });

    const WINDOW = { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" };

    it.each(["month", "account"])(
      "splits %s buckets by category",
      (groupBy) => {
        expect(
          spendingStatsSchema.safeParse({
            query: { ...WINDOW, groupBy, splitBy: "category" },
          }).success,
        ).toBe(true);
      },
    );

    // Buckets times categories over a whole history is not a response this endpoint builds.
    it.each([
      ["no window at all", {}],
      ["only a start", { from: WINDOW.from }],
      ["only an end", { to: WINDOW.to }],
    ])("refuses a split with %s", (_label, window) => {
      expect(
        spendingStatsSchema.safeParse({
          query: { ...window, groupBy: "month", splitBy: "category" },
        }).success,
      ).toBe(false);
    });

    it.each([
      ["it would repeat the grouping", { groupBy: "category" }],
      ["the grouping defaults to category", {}],
      ["the tag unwind would multiply it", { groupBy: "tag" }],
      ["a day grouping grows with the window", { groupBy: "day" }],
    ])("refuses a split when %s", (_label, query) => {
      expect(
        spendingStatsSchema.safeParse({
          query: { ...WINDOW, ...query, splitBy: "category" },
        }).success,
      ).toBe(false);
    });

    it("takes the categories of a budget as one list", () => {
      const result = spendingStatsSchema.safeParse({
        query: { groupBy: "day", categoryIds: `${validUUID},${validUUID2}` },
      });

      expect(result.success).toBe(true);
      expect(
        (result.data as { query: { categoryIds: string[] } }).query.categoryIds,
      ).toEqual([validUUID, validUUID2]);
    });

    it.each([
      ["an id that is not one", { categoryIds: "food" }],
      ["an empty list", { categoryIds: "" }],
      [
        "more than a budget can hold",
        { categoryIds: Array.from({ length: 21 }, () => validUUID).join(",") },
      ],
      [
        "a range that runs backwards",
        { from: "2026-09-01T00:00:00Z", to: "2026-08-01T00:00:00Z" },
      ],
    ])("rejects %s", (_label, query) => {
      expect(spendingStatsSchema.safeParse({ query }).success).toBe(false);
    });
  });

  // O-B1: an offline client mints the id so its create can be retried.
  describe("client-minted id on creates", () => {
    const bodies: [
      string,
      {
        safeParse: (v: unknown) => {
          success: boolean;
          data?: { body?: { id?: string } };
        };
      },
      Record<string, unknown>,
    ][] = [
      [
        "createAccountSchema",
        createAccountSchema,
        { name: "Cash", type: "CASH" },
      ],
      ["createCategorySchema", createCategorySchema, { name: "Food" }],
      [
        "createTransactionSchema",
        createTransactionSchema,
        {
          type: "EXPENSE",
          amount: 10,
          date: "2026-03-28T00:00:00.000Z",
          fromAccountId: validUUID2,
        },
      ],
      ["quickAddTransactionSchema", quickAddTransactionSchema, { amount: 10 }],
      [
        "createBudgetSchema",
        createBudgetSchema,
        {
          name: "Food",
          color: "RED",
          categoryIds: [],
          amount: 100,
          periodType: "MONTHLY",
        },
      ],
    ];

    it.each(bodies)("%s keeps a valid id", (_name, schema, body) => {
      const result = schema.safeParse({
        query: {},
        body: { ...body, id: validUUID },
      });
      expect(result.success).toBe(true);
      expect(result.data?.body?.id).toBe(validUUID);
    });

    it.each(bodies)("%s stays valid without an id", (_name, schema, body) => {
      const result = schema.safeParse({ query: {}, body });
      expect(result.success).toBe(true);
      expect(result.data?.body?.id).toBeUndefined();
    });

    it.each(bodies)(
      "%s rejects an id that is not a UUID",
      (_name, schema, body) => {
        const result = schema.safeParse({
          query: {},
          body: { ...body, id: "42" },
        });
        expect(result.success).toBe(false);
      },
    );
  });

  describe("syncBatchSchema (O-B4)", () => {
    const operation = (
      n: number,
      over: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      opId: `01940000-0000-7000-8000-${String(n).padStart(12, "0")}`,
      seq: n,
      occurredAt: "2026-09-05T10:00:00.000Z",
      entity: "account",
      action: "archive",
      id: validUUID,
      opVersion: 1,
      ...over,
    });

    it("parses a minimal operation and fills the defaults", () => {
      const result = syncBatchSchema.safeParse({
        body: { operations: [operation(1)] },
      });
      expect(result.success).toBe(true);
      expect(result.data?.body.operations[0]).toMatchObject({
        payload: {},
        dependsOn: [],
      });
    });

    it("keeps payload.body verbatim: the service validates it per action", () => {
      const result = syncBatchSchema.safeParse({
        body: {
          operations: [
            operation(1, {
              action: "create",
              payload: {
                body: { name: "x", anything: true },
                query: { reference: "2026-12-01T00:00:00.000Z" },
              },
            }),
          ],
        },
      });
      expect(result.success).toBe(true);
      expect(result.data?.body.operations[0].payload.body).toEqual({
        name: "x",
        anything: true,
      });
    });

    it("rejects an empty batch and one past 200 operations", () => {
      expect(
        syncBatchSchema.safeParse({ body: { operations: [] } }).success,
      ).toBe(false);
      const tooMany = Array.from({ length: 201 }, (_, i) => operation(i));
      const result = syncBatchSchema.safeParse({
        body: { operations: tooMany },
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain("at most 200");
    });

    it("rejects a repeated opId", () => {
      const result = syncBatchSchema.safeParse({
        body: {
          operations: [operation(1), operation(2, { opId: operation(1).opId })],
        },
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(["body", "operations"]);
    });

    it.each([
      ["entity", "user"],
      ["opId", "not-a-uuid"],
      ["id", "42"],
      ["seq", -1],
      ["seq", 1.5],
      ["occurredAt", "2026-09-05"],
      ["baseUpdatedAt", "yesterday"],
      ["opVersion", 0],
      ["dependsOn", ["nope"]],
      ["payload", { query: { reference: "2026-12-01" } }],
    ])("rejects %s = %j", (field, value) => {
      const result = syncBatchSchema.safeParse({
        body: { operations: [operation(1, { [field]: value })] },
      });
      expect(result.success).toBe(false);
    });

    it("does not judge the action here: an unknown one is the service's per-operation rejection", () => {
      const result = syncBatchSchema.safeParse({
        body: { operations: [operation(1, { action: "teleport" })] },
      });
      expect(result.success).toBe(true);
    });
  });
});
