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

import {
  createAccountSchema,
  createCategorySchema,
  createTransactionSchema,
  getCategoriesSchema,
  getTransactionsSchema,
  idParamSchema,
  loginSchema,
  paginationQuerySchema,
  registerSchema,
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
        body: { email: "new@example.com" },
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid update with password", () => {
      const result = updateUserSchema.safeParse({
        params: { id: validUUID },
        body: { password: "newpassword123" },
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

    it("should accept valid category with emoji", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food", emoji: "🍔" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject emoji exceeding 8 characters", () => {
      const result = createCategorySchema.safeParse({
        body: { name: "Food", emoji: "a".repeat(9) },
      });
      expect(result.success).toBe(false);
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

    it("should accept update with only emoji", () => {
      const result = updateCategorySchema.safeParse({
        params: { id: validUUID },
        body: { emoji: "🚗" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty body (no name or emoji)", () => {
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
  });
});
