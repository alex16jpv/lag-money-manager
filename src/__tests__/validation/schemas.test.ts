jest.mock("../../shared/constants", () => ({
  ACCOUNT_LINK_TOKEN_FORMAT: /^[A-Za-z0-9_-]{64}$/,
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
    SETTLEMENT: "SETTLEMENT",
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
  MAX_GROUP_PARTICIPANTS: 20,
  MAX_EXPENSE_GUESTS: 999,
  GROUP_SPLIT_MODES: { EQUAL: "EQUAL", PERCENT: "PERCENT" },
  SPLIT_MODES: {
    EQUAL: "EQUAL",
    PERCENT: "PERCENT",
    EXACT: "EXACT",
    FIXED_REST: "FIXED_REST",
  },
  SHARE_PARTIES: { USER: "USER", CONTACT: "CONTACT", GUESTS: "GUESTS" },
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
  TYPES_OUTSIDE_SPENDING: ["ADJUSTMENT", "SETTLEMENT"],
  TYPES_RECORDED_ELSEWHERE: ["SETTLEMENT"],
  SETTLEMENT_PARTIES: { CONTACT: "CONTACT", GUESTS: "GUESTS" },
  GROUP_STATUSES: { OPEN: "OPEN", SETTLED: "SETTLED" },
  SHARED_HISTORY_REASONS: {
    SPLIT: "SPLIT",
    SPLIT_EDITED: "SPLIT_EDITED",
    AMOUNT_CHANGED: "AMOUNT_CHANGED",
    UNSPLIT: "UNSPLIT",
    PAYMENT: "PAYMENT",
    REIMPUTED: "REIMPUTED",
  },
}));

import {
  confirmEmailChangeSchema,
  createAccountSchema,
  createBudgetSchema,
  createCategorySchema,
  createContactSchema,
  createSettlementSchema,
  createSharedExpenseSchema,
  createTransactionSchema,
  forgotPasswordSchema,
  getCategoriesSchema,
  getTransactionsSchema,
  idParamSchema,
  loginSchema,
  paginationQuerySchema,
  quickAddTransactionSchema,
  requestEmailChangeSchema,
  resendEmailChangeSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  restoreFromLinkSchema,
  signUpConfirmSchema,
  signUpResendSchema,
  signUpSchema,
  spendingStatsSchema,
  syncBatchSchema,
  updateAccountSchema,
  updateCategorySchema,
  updateContactSchema,
  updateTransactionSchema,
  updateUserSchema,
  verifyEmailSchema,
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

  describe("signUpSchema", () => {
    const validSignUp = {
      body: {
        name: "John Doe",
        email: "john@example.com",
        password: "password123",
        captcha: "token",
      },
    };

    it("should accept a supported locale", () => {
      const result = signUpSchema.safeParse({
        body: { ...validSignUp.body, locale: "es" },
      });
      expect(result.success).toBe(true);
    });

    it("should reject an unsupported locale", () => {
      const result = signUpSchema.safeParse({
        body: { ...validSignUp.body, locale: "fr" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid sign-up data", () => {
      const result = signUpSchema.safeParse(validSignUp);
      expect(result.success).toBe(true);
    });

    it("should reject empty name", () => {
      const result = signUpSchema.safeParse({
        body: { ...validSignUp.body, name: "" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject name exceeding 255 characters", () => {
      const result = signUpSchema.safeParse({
        body: { ...validSignUp.body, name: "a".repeat(256) },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid email format", () => {
      const result = signUpSchema.safeParse({
        body: { ...validSignUp.body, email: "not-an-email" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject email exceeding 255 characters", () => {
      const result = signUpSchema.safeParse({
        body: {
          ...validSignUp.body,
          email: "a".repeat(250) + "@test.com",
        },
      });
      expect(result.success).toBe(false);
    });

    it("should reject password shorter than 8 characters", () => {
      const result = signUpSchema.safeParse({
        body: { ...validSignUp.body, password: "short" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject password exceeding 128 characters", () => {
      const result = signUpSchema.safeParse({
        body: { ...validSignUp.body, password: "a".repeat(129) },
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const result = signUpSchema.safeParse({ body: {} });
      expect(result.success).toBe(false);
    });
  });

  describe("forgotPasswordSchema [T-207]", () => {
    it("normalizes the address and needs the captcha token", () => {
      const parsed = forgotPasswordSchema.parse({
        body: { email: " Ana@Example.com ", captcha: "token" },
      });
      expect(parsed.body.email).toBe("ana@example.com");
      expect(
        forgotPasswordSchema.safeParse({ body: { email: "ana@example.com" } })
          .success,
      ).toBe(false);
    });
  });

  describe("resetPasswordSchema [T-207]", () => {
    const password = "new password 1";

    it.each([
      [
        "the code with its address",
        { email: "ana@example.com", code: " 004821 " },
      ],
      ["the link's token alone", { token: "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPz" }],
    ])("takes %s", (_label, proof) => {
      expect(
        resetPasswordSchema.safeParse({
          body: { ...proof, newPassword: password },
        }).success,
      ).toBe(true);
    });

    it.each([
      ["a code without its address", { code: "004821" }],
      [
        "a code that is not six digits",
        { email: "ana@example.com", code: "4821" },
      ],
      [
        "a code and a token together",
        {
          email: "ana@example.com",
          code: "004821",
          token: "q7Xk2mVb9RtL4wPzq7",
        },
      ],
      [
        "a token with characters no link carries",
        { token: "q7Xk2mVb9RtL4wPz/../x" },
      ],
      ["no proof at all", {}],
    ])("refuses %s", (_label, proof) => {
      expect(
        resetPasswordSchema.safeParse({
          body: { ...proof, newPassword: password },
        }).success,
      ).toBe(false);
    });

    it("keeps the password within 8 and 128 characters", () => {
      const proof = { token: "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPz" };
      expect(
        resetPasswordSchema.safeParse({
          body: { ...proof, newPassword: "short" },
        }).success,
      ).toBe(false);
    });
  });

  describe("the email's confirmation [T-209]", () => {
    const signUp = {
      name: "Ana",
      email: "ana@example.com",
      password: "password123",
    };

    it("needs a sign-up's captcha, and keeps the token [T-228]", () => {
      expect(signUpSchema.safeParse({ body: signUp }).success).toBe(false);
      expect(
        signUpSchema.parse({ body: { ...signUp, captcha: "token" } }).body
          .captcha,
      ).toBe("token");
      expect(
        signUpSchema.safeParse({ body: { ...signUp, captcha: "" } }).success,
      ).toBe(false);
    });

    it.each([
      ["the code", { code: " 004821 " }],
      ["the link's token", { token: "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPz" }],
    ])("verifies with %s", (_label, body) => {
      expect(verifyEmailSchema.safeParse({ body }).success).toBe(true);
    });

    it.each([
      ["both", { code: "004821", token: "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPz" }],
      ["neither", {}],
      ["a code that is not six digits", { code: "4821" }],
      ["an address with the code", { code: "004821", email: "a@b.co" }],
    ])("refuses to verify with %s", (_label, body) => {
      expect(verifyEmailSchema.safeParse({ body }).success).toBe(false);
    });

    it("needs the captcha to resend", () => {
      expect(
        resendVerificationSchema.safeParse({ body: { captcha: "token" } })
          .success,
      ).toBe(true);
      expect(resendVerificationSchema.safeParse({ body: {} }).success).toBe(
        false,
      );
    });
  });

  describe("the sign-up and the restore link [T-238]", () => {
    const signUpToken = "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPzq7Xk2mVb9Rt";

    it("confirms with the sign-up's token and the six digits, and nothing else", () => {
      expect(
        signUpConfirmSchema.safeParse({ body: { signUpToken, code: "482913" } })
          .success,
      ).toBe(true);
      expect(
        signUpConfirmSchema.safeParse({ body: { signUpToken, code: "48291" } })
          .success,
      ).toBe(false);
      expect(
        signUpConfirmSchema.safeParse({
          body: { signUpToken, code: "482913", email: "a@b.co" },
        }).success,
      ).toBe(false);
    });

    it("needs the captcha to resend the sign-up", () => {
      expect(
        signUpResendSchema.safeParse({ body: { signUpToken, captcha: "t" } })
          .success,
      ).toBe(true);
      expect(
        signUpResendSchema.safeParse({ body: { signUpToken } }).success,
      ).toBe(false);
    });

    it("takes only a token shaped like an account link's", () => {
      const token = "A".repeat(64);
      expect(restoreFromLinkSchema.safeParse({ body: { token } }).success).toBe(
        true,
      );
      expect(
        restoreFromLinkSchema.safeParse({ body: { token: signUpToken } })
          .success,
      ).toBe(false);
      expect(
        restoreFromLinkSchema.safeParse({ body: { token, extra: 1 } }).success,
      ).toBe(false);
    });
  });

  describe("the change of email [T-221]", () => {
    const params = { id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70" };
    const asked = {
      email: " Ana.Ruiz@Example.org ",
      currentPassword: "Offline!2026",
      captcha: "token",
    };

    it("asks with the new address, the current password and the captcha, and normalizes the address", () => {
      const parsed = requestEmailChangeSchema.safeParse({
        params,
        body: asked,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.body.email).toBe("ana.ruiz@example.org");
    });

    it.each([
      ["no current password", { ...asked, currentPassword: undefined }],
      ["no captcha", { ...asked, captcha: undefined }],
      ["an address that is not one", { ...asked, email: "not-an-address" }],
    ])("refuses to ask with %s", (_label, body) => {
      expect(requestEmailChangeSchema.safeParse({ params, body }).success).toBe(
        false,
      );
    });

    it("needs the captcha to resend", () => {
      expect(
        resendEmailChangeSchema.safeParse({
          params,
          body: { captcha: "token" },
        }).success,
      ).toBe(true);
      expect(
        resendEmailChangeSchema.safeParse({ params, body: {} }).success,
      ).toBe(false);
    });

    it.each([
      ["the code", { code: "004821" }],
      ["the link's token", { token: "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPz" }],
      [
        "the link's token and this browser's refresh token",
        { token: "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPz", refreshToken: "r.e.f" },
      ],
    ])("confirms with %s", (_label, body) => {
      expect(confirmEmailChangeSchema.safeParse({ body }).success).toBe(true);
    });

    it.each([
      ["both", { code: "004821", token: "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPz" }],
      ["neither", {}],
      ["a refresh token with the code", { code: "004821", refreshToken: "r" }],
      ["a code that is not six digits", { code: "4821" }],
    ])("refuses to confirm with %s", (_label, body) => {
      expect(confirmEmailChangeSchema.safeParse({ body }).success).toBe(false);
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

    it("never carries an email to the service [T-232]", () => {
      const result = updateUserSchema.safeParse({
        params: { id: validUUID },
        body: { name: "New Name", email: "new@example.com" },
      });
      expect(result.success).toBe(true);
      expect(result.data?.body).toEqual({ name: "New Name" });
    });

    it("asks currentPassword for a new password", () => {
      const result = updateUserSchema.safeParse({
        params: { id: validUUID },
        body: { password: "newpassword123" },
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(["body", "currentPassword"]);
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

    it("accepts the two debt amounts [T-87]", () => {
      const result = createAccountSchema.safeParse({
        body: {
          name: "Visa Gold",
          type: "CARD",
          creditLimit: 4000000,
          borrowedAmount: 12000000,
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects a debt amount of zero or less [T-87]", () => {
      for (const creditLimit of [0, -1]) {
        const result = createAccountSchema.safeParse({
          body: { name: "Visa Gold", type: "CARD", creditLimit },
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects a debt amount with more than two decimals [T-87]", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "Visa Gold", type: "CARD", creditLimit: 100.555 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects null for a debt amount on create [T-87]", () => {
      const result = createAccountSchema.safeParse({
        body: { name: "Visa Gold", type: "CARD", creditLimit: null },
      });
      expect(result.success).toBe(false);
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

    it("accepts a debt amount, and null to clear it [T-87]", () => {
      for (const creditLimit of [4000000, null]) {
        const result = updateAccountSchema.safeParse({
          params: { id: validUUID },
          body: { creditLimit },
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects a debt amount of zero [T-87]", () => {
      const result = updateAccountSchema.safeParse({
        params: { id: validUUID },
        body: { borrowedAmount: 0 },
      });
      expect(result.success).toBe(false);
    });

    it("drops a debt amount the body did not declare [T-87]", () => {
      const result = updateAccountSchema.safeParse({
        params: { id: validUUID },
        body: { creditLimit: 4000000, interestRate: 12 },
      });
      expect(result.success).toBe(true);
      expect(result.data?.body).not.toHaveProperty("interestRate");
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

  describe("createContactSchema", () => {
    it("accepts a name on its own", () => {
      const result = createContactSchema.safeParse({ body: { name: "Ana" } });
      expect(result.success).toBe(true);
    });

    it("trims the name, because the index collation does not fold whitespace", () => {
      const result = createContactSchema.safeParse({
        body: { name: "  Ana  " },
      });
      expect(result.success).toBe(true);
      expect((result.data as { body: { name: string } }).body.name).toBe("Ana");
    });

    it("lowercases the email so two spellings resolve to one identifier", () => {
      const result = createContactSchema.safeParse({
        body: { name: "Ana", email: " Ana@Example.COM " },
      });
      expect(result.success).toBe(true);
      expect((result.data as { body: { email: string } }).body.email).toBe(
        "ana@example.com",
      );
    });

    it("rejects an email that is not one", () => {
      const result = createContactSchema.safeParse({
        body: { name: "Ana", email: "ana@" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty name", () => {
      const result = createContactSchema.safeParse({ body: { name: "" } });
      expect(result.success).toBe(false);
    });

    it("rejects a colour outside the palette", () => {
      const result = createContactSchema.safeParse({
        body: { name: "Ana", color: "RAINBOW" },
      });
      expect(result.success).toBe(false);
    });

    it("drops linkedUserId: it is the server's, never the client's", () => {
      const result = createContactSchema.safeParse({
        body: { name: "Ana", linkedUserId: validUUID },
      });
      expect(result.success).toBe(true);
      const body = (result.data as { body: Record<string, unknown> }).body;
      expect(body).not.toHaveProperty("linkedUserId");
    });

    it("accepts a client-minted id and rejects one that is not a UUID", () => {
      expect(
        createContactSchema.safeParse({ body: { id: validUUID, name: "Ana" } })
          .success,
      ).toBe(true);
      expect(
        createContactSchema.safeParse({ body: { id: "42", name: "Ana" } })
          .success,
      ).toBe(false);
    });
  });

  describe("updateContactSchema", () => {
    it("accepts a single field", () => {
      const result = updateContactSchema.safeParse({
        params: { id: validUUID },
        body: { name: "Ana María" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts null to clear the colour and the email", () => {
      const result = updateContactSchema.safeParse({
        params: { id: validUUID },
        body: { color: null, email: null },
      });
      expect(result.success).toBe(true);
    });

    it("rejects an empty body", () => {
      const result = updateContactSchema.safeParse({
        params: { id: validUUID },
        body: {},
      });
      expect(result.success).toBe(false);
    });

    it("rejects an id that is not a UUID", () => {
      const result = updateContactSchema.safeParse({
        params: { id: "42" },
        body: { name: "Ana" },
      });
      expect(result.success).toBe(false);
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

  describe("createSharedExpenseSchema (T-115)", () => {
    const body = (
      over: Record<string, unknown> = {},
    ): { params: { id: string }; body: Record<string, unknown> } => ({
      params: { id: validUUID },
      body: { amount: 90000, date: "2026-08-15T23:00:00.000Z", ...over },
    });

    it("takes an amount and a date when no movement is named", () => {
      expect(createSharedExpenseSchema.safeParse(body()).success).toBe(true);
    });

    it.each(["amount", "date"] as const)("requires %s without one", (field) => {
      const without = body();
      delete (without.body as Record<string, unknown>)[field];
      expect(createSharedExpenseSchema.safeParse(without).success).toBe(false);
    });

    it("takes a movement on its own", () => {
      const result = createSharedExpenseSchema.safeParse({
        params: { id: validUUID },
        body: { transactionId: validUUID2 },
      });
      expect(result.success).toBe(true);
    });

    // The movement states all three; a second statement is how the two end up disagreeing.
    it.each([
      ["amount", 90000],
      ["date", "2026-08-15T23:00:00.000Z"],
      ["description", "Something else"],
      ["paidByContactId", validUUID],
    ])("refuses %s beside a movement", (field, value) => {
      const result = createSharedExpenseSchema.safeParse({
        params: { id: validUUID },
        body: { transactionId: validUUID2, [field]: value },
      });
      expect(result.success).toBe(false);
    });

    it("takes a null paidByContactId beside a movement, which is you", () => {
      const result = createSharedExpenseSchema.safeParse({
        params: { id: validUUID },
        body: { transactionId: validUUID2, paidByContactId: null },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("createSettlementSchema: the group it is paid from [T-240]", () => {
    const settle = (
      over: Record<string, unknown> = {},
    ): ReturnType<typeof createSettlementSchema.safeParse> =>
      createSettlementSchema.safeParse({
        body: {
          contactId: validUUID,
          date: "2026-08-25T18:00:00.000Z",
          collected: 20000,
          ...over,
        },
      });

    it("takes a group with a person, and keeps it", () => {
      const result = settle({ groupId: validUUID2 });
      expect(result.success).toBe(true);
      expect(result.data?.body.groupId).toBe(validUUID2);
    });

    it("takes no group, and a null one, which is a payment from People", () => {
      expect(settle().success).toBe(true);
      expect(settle().data?.body.groupId).toBeUndefined();
      expect(settle({ groupId: null }).data?.body.groupId).toBeNull();
    });

    it("refuses a group that is not an id", () => {
      const result = settle({ groupId: "cine" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(["body", "groupId"]);
    });

    it("refuses a group beside a block of guests, which lives in one expense", () => {
      const result = settle({
        contactId: undefined,
        expenseId: validUUID,
        groupId: validUUID2,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([
        ["body", "groupId"],
      ]);
    });
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
