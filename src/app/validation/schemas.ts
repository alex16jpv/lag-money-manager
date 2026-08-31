import { z } from "zod";

import {
  ACCOUNT_TYPES,
  BUDGET_PERIOD_TYPES,
  BUDGET_TYPES,
  CATEGORY_TYPES,
  COLORS,
  TRANSACTION_TYPES,
} from "../../shared/constants";
import { MAX_AMOUNT } from "../../shared/money";
import { isValidTimeZone } from "../../shared/timezone";

const timezoneField = z
  .string()
  .refine(isValidTimeZone, "Invalid IANA timezone")
  .optional();
import { MAX_LIMIT } from "../../shared/pagination";

// Money is decimal in the API but stored as integer cents, so amounts must
// have at most 2 decimals and stay within a sane bound (rejects 10.555 and 1e300).
const moneyAmount = z
  .number()
  .positive("Amount must be greater than 0")
  .multipleOf(0.01, "Amount must have at most 2 decimal places")
  .max(MAX_AMOUNT, `Amount must be at most ${MAX_AMOUNT}`);

const initialBalance = z
  .number()
  .finite("Balance must be a finite number")
  .multipleOf(0.01, "Balance must have at most 2 decimal places")
  .min(-MAX_AMOUNT, `Balance must be at least ${-MAX_AMOUNT}`)
  .max(MAX_AMOUNT, `Balance must be at most ${MAX_AMOUNT}`)
  .default(0);

const accountTypeValues = Object.keys(ACCOUNT_TYPES) as [string, ...string[]];
const transactionTypeValues = Object.keys(TRANSACTION_TYPES) as [
  string,
  ...string[],
];
const categoryTypeValues = Object.keys(CATEGORY_TYPES) as [string, ...string[]];
const colorValues = Object.keys(COLORS) as [string, ...string[]];
const budgetPeriodValues = Object.keys(BUDGET_PERIOD_TYPES) as [
  string,
  ...string[],
];
const budgetTypeValues = Object.keys(BUDGET_TYPES) as [string, ...string[]];
const isoDate = z
  .string()
  .datetime({ offset: true, message: "Must be a valid ISO 8601 date" })
  .transform((s) => new Date(s));

// Trim + casefold + dedupe: "Café", "café" and "café " must be ONE tag,
// or the per-tag spending stats fragment into ghost buckets.
const normalizedTags = z
  .array(z.string().min(1).max(50))
  .max(30)
  .transform((tags) => [
    ...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  ])
  .optional();

// Normalized so Foo@x.com and foo@x.com resolve to the same account.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email format")
  .max(255);

export const paginationQuerySchema = z.object({
  query: z.object({
    limit: z.coerce
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}`)
      .optional(),
    offset: z.coerce
      .number()
      .int("Offset must be an integer")
      .min(0, "Offset must be non-negative")
      .optional(),
    cursor: z.string().uuid("Cursor must be a valid UUID").optional(),
    ids: z
      .string()
      .transform((val) => val.split(",").map((s) => s.trim()))
      .pipe(
        z.array(z.string().uuid("Each ID must be a valid UUID")).min(1).max(100),
      )
      .optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
  }),
});

export const getTransactionsSchema = z.object({
  query: z.object({
    limit: z.coerce
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}`)
      .optional(),
    offset: z.coerce
      .number()
      .int("Offset must be an integer")
      .min(0, "Offset must be non-negative")
      .optional(),
    cursor: z.string().uuid("Cursor must be a valid UUID").optional(),
    ids: z
      .string()
      .transform((val) => val.split(",").map((s) => s.trim()))
      .pipe(
        z.array(z.string().uuid("Each ID must be a valid UUID")).min(1).max(100),
      )
      .optional(),
    accountId: z.string().uuid("accountId must be a valid UUID").optional(),
    categoryId: z.string().uuid("categoryId must be a valid UUID").optional(),
    type: z
      .enum(transactionTypeValues, {
        error: `Invalid transaction type. Available: ${transactionTypeValues.join(", ")}`,
      })
      .optional(),
    pendingDetails: z.enum(["true", "false"]).optional(),
    uncategorized: z.enum(["true", "false"]).optional(),
    from: z
      .string()
      .datetime({ offset: true, message: "from must be a valid ISO 8601 date" })
      .optional(),
    to: z
      .string()
      .datetime({ offset: true, message: "to must be a valid ISO 8601 date" })
      .optional(),
    tag: z.string().min(1).max(50).optional(),
  }),
});

export const getCategoriesSchema = z.object({
  query: z.object({
    limit: z.coerce
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}`)
      .optional(),
    offset: z.coerce
      .number()
      .int("Offset must be an integer")
      .min(0, "Offset must be non-negative")
      .optional(),
    cursor: z.string().uuid("Cursor must be a valid UUID").optional(),
    ids: z
      .string()
      .transform((val) => val.split(",").map((s) => s.trim()))
      .pipe(
        z.array(z.string().uuid("Each ID must be a valid UUID")).min(1).max(100),
      )
      .optional(),
    type: z
      .enum(categoryTypeValues, {
        error: `Invalid category type. Available: ${categoryTypeValues.join(", ")}`,
      })
      .optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID must be a valid UUID"),
  }),
  body: z
    .object({
      name: z.string().min(1).max(255).optional(),
      email: emailField.optional(),
      password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .max(128)
        .optional(),
      // Re-authentication: a hijacked access token (15 min) must not be able
      // to take over the account by swapping the credentials.
      currentPassword: z.string().min(1).max(128).optional(),
      timezone: timezoneField,
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: "At least one field must be provided",
    })
    .refine((data) => !(data.password || data.email) || data.currentPassword, {
      message: "currentPassword is required to change email or password",
      path: ["currentPassword"],
    }),
});

export const createAccountSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required").max(255),
    type: z.enum(accountTypeValues, {
      error: `Invalid account type. Available: ${accountTypeValues.join(", ")}`,
    }),
    balance: initialBalance,
    color: z
      .enum(colorValues, {
        error: `Invalid color. Available: ${colorValues.join(", ")}`,
      })
      .optional(),
  }),
});

export const updateAccountSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID must be a valid UUID"),
  }),
  body: z
    .object({
      name: z.string().min(1).max(255).optional(),
      type: z
        .enum(accountTypeValues, {
          error: `Invalid account type. Available: ${accountTypeValues.join(", ")}`,
        })
        .optional(),
      color: z
        .enum(colorValues, {
          error: `Invalid color. Available: ${colorValues.join(", ")}`,
        })
        .optional()
        .nullable(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: "At least one field must be provided",
    }),
});

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required").max(255),
    emoji: z.string().max(16, "Emoji must be at most 16 characters").optional(),
    color: z
      .enum(colorValues, {
        error: `Invalid color. Available: ${colorValues.join(", ")}`,
      })
      .optional(),
    type: z
      .enum(categoryTypeValues, {
        error: `Invalid category type. Available: ${categoryTypeValues.join(", ")}`,
      })
      .optional(),
  }),
});

export const updateCategorySchema = z.object({
  params: z.object({
    id: z.string().uuid("ID must be a valid UUID"),
  }),
  body: z
    .object({
      name: z.string().min(1).max(255).optional(),
      emoji: z.string().max(16, "Emoji must be at most 16 characters").optional(),
      color: z
        .enum(colorValues, {
          error: `Invalid color. Available: ${colorValues.join(", ")}`,
        })
        .optional()
        .nullable(),
      type: z
        .enum(categoryTypeValues, {
          error: `Invalid category type. Available: ${categoryTypeValues.join(", ")}`,
        })
        .optional()
        .nullable(),
    })
    .refine(
      (data) => Object.values(data).some((v) => v !== undefined),
      {
        message: "At least one field must be provided",
      },
    ),
});

export const spendingStatsSchema = z.object({
  query: z
    .object({
      groupBy: z.enum(["category", "day", "tag"]).optional(),
      type: z.enum(transactionTypeValues).optional(),
      from: z
        .string()
        .datetime({ offset: true, message: "from must be a valid ISO 8601 date" })
        .optional(),
      to: z
        .string()
        .datetime({ offset: true, message: "to must be a valid ISO 8601 date" })
        .optional(),
    })
    .refine(
      (q) => !q.from || !q.to || new Date(q.from) <= new Date(q.to),
      { message: "from must be before or equal to to", path: ["from"] },
    ),
});

// Every budget route resolves the period from `reference`, so all must validate it.
const budgetReferenceQuery = z.object({
  reference: z
    .string()
    .datetime({ offset: true, message: "reference must be a valid ISO 8601 date" })
    .optional(),
});

export const getBudgetsSchema = z.object({
  query: budgetReferenceQuery.extend({
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    cursor: z.string().uuid("Cursor must be a valid UUID").optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
  }),
});

export const budgetIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid("ID must be a valid UUID") }),
  query: budgetReferenceQuery,
});

export const createBudgetSchema = z.object({
  query: budgetReferenceQuery,
  body: z.object({
    name: z.string().min(1, "Name is required").max(255),
    color: z.enum(colorValues, {
      error: `Invalid color. Available: ${colorValues.join(", ")}`,
    }),
    // Empty array = global budget: counts ALL expenses of the user.
    categoryIds: z
      .array(z.string().uuid("Each categoryId must be a valid UUID"))
      .max(20),
    type: z.enum(budgetTypeValues).optional(),
    amount: moneyAmount,
    periodType: z.enum(budgetPeriodValues, {
      error: `Invalid period. Available: ${budgetPeriodValues.join(", ")}`,
    }),
    periodStartDate: isoDate.optional(),
    periodEndDate: isoDate.optional(),
    effectiveFrom: isoDate.optional(),
    note: z.string().max(1000).optional().nullable(),
  }),
});

export const updateBudgetSchema = z.object({
  params: z.object({ id: z.string().uuid("ID must be a valid UUID") }),
  query: budgetReferenceQuery,
  body: z
    .object({
      name: z.string().min(1).max(255).optional(),
      color: z.enum(colorValues).optional(),
      categoryIds: z
        .array(z.string().uuid("Each categoryId must be a valid UUID"))
        .max(20)
        .optional(),
      type: z.enum(budgetTypeValues).optional(),
      amount: moneyAmount.optional(),
      periodType: z.enum(budgetPeriodValues).optional(),
      periodStartDate: isoDate.optional(),
      periodEndDate: isoDate.optional(),
      effectiveFrom: isoDate.nullable().optional(),
      note: z.string().max(1000).optional().nullable(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: "At least one field must be provided",
    }),
});

export const budgetAmountOverrideSchema = z.object({
  params: z.object({ id: z.string().uuid("ID must be a valid UUID") }),
  query: budgetReferenceQuery,
  // 0 is allowed: "this budget doesn't apply this period".
  body: z.object({
    amount: z
      .number()
      .min(0, "Amount must be at least 0")
      .multipleOf(0.01, "Amount must have at most 2 decimal places")
      .max(MAX_AMOUNT, `Amount must be at most ${MAX_AMOUNT}`),
  }),
});

export const idParamSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID must be a valid UUID"),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: emailField,
    password: z.string().min(1, "Password is required"),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, "refreshToken is required"),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required").max(255),
    email: emailField,
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128),
    timezone: timezoneField,
  }),
});

export const createTransactionSchema = z.object({
  body: z
    .object({
      type: z.enum(transactionTypeValues, {
        error: `Invalid transaction type. Available: ${transactionTypeValues.join(", ")}`,
      }),
      amount: moneyAmount,
      date: z
        .string()
        .datetime({ offset: true, message: "Date must be a valid ISO 8601 date" }),
      categoryId: z
        .string()
        .uuid("categoryId must be a valid UUID")
        .optional()
        .nullable(),
      description: z.string().max(255).optional().nullable(),
      fromAccountId: z
        .string()
        .uuid("fromAccountId must be a valid UUID")
        .optional()
        .nullable(),
      toAccountId: z
        .string()
        .uuid("toAccountId must be a valid UUID")
        .optional()
        .nullable(),
      tags: normalizedTags,
      note: z.string().max(1000).optional().nullable(),
    })
    .superRefine((data, ctx) => {
      if (data.type === "EXPENSE" && !data.fromAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "fromAccountId is required for expense transactions",
          path: ["fromAccountId"],
        });
      }
      if (data.type === "INCOME" && !data.toAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "toAccountId is required for income transactions",
          path: ["toAccountId"],
        });
      }
      if (data.type === "ADJUSTMENT") {
        const sides = [data.fromAccountId, data.toAccountId].filter(Boolean);
        if (sides.length !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Adjustment requires exactly one of fromAccountId (decrease) or toAccountId (increase)",
            path: ["fromAccountId"],
          });
        }
        if (data.categoryId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "categoryId is not allowed for adjustment transactions",
            path: ["categoryId"],
          });
        }
      }
      if (data.type === "TRANSFER") {
        if (!data.fromAccountId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "fromAccountId is required for transfer transactions",
            path: ["fromAccountId"],
          });
        }
        if (!data.toAccountId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "toAccountId is required for transfer transactions",
            path: ["toAccountId"],
          });
        }
        if (
          data.fromAccountId &&
          data.toAccountId &&
          data.fromAccountId === data.toAccountId
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "fromAccountId and toAccountId must be different",
            path: ["toAccountId"],
          });
        }
      }
    }),
});

export const updateTransactionSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID must be a valid UUID"),
  }),
  body: z
    .object({
      type: z
        .enum(transactionTypeValues, {
          error: `Invalid transaction type. Available: ${transactionTypeValues.join(", ")}`,
        })
        .optional(),
      amount: moneyAmount.optional(),
      date: z
        .string()
        .datetime({ offset: true, message: "Date must be a valid ISO 8601 date" })
        .optional(),
      categoryId: z
        .string()
        .uuid("categoryId must be a valid UUID")
        .optional()
        .nullable(),
      description: z.string().max(255).optional().nullable(),
      fromAccountId: z
        .string()
        .uuid("fromAccountId must be a valid UUID")
        .optional()
        .nullable(),
      toAccountId: z
        .string()
        .uuid("toAccountId must be a valid UUID")
        .optional()
        .nullable(),
      tags: normalizedTags,
      note: z.string().max(1000).optional().nullable(),
      pendingDetails: z.boolean().optional(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: "At least one field must be provided",
    }),
});

// Quick capture is for real cash flows; ADJUSTMENT would create an
// un-detailable pendingDetails entry (it can't take a category).
const quickAddTypeValues = Object.keys(TRANSACTION_TYPES).filter(
  (t) => t !== "ADJUSTMENT",
) as [string, ...string[]];

export const quickAddTransactionSchema = z.object({
  body: z.object({
    amount: moneyAmount,
    type: z.enum(quickAddTypeValues).optional(),
    date: z
      .string()
      .datetime({ offset: true, message: "Date must be a valid ISO 8601 date" })
      .optional(),
    categoryId: z.string().uuid("categoryId must be a valid UUID").optional(),
    fromAccountId: z
      .string()
      .uuid("fromAccountId must be a valid UUID")
      .optional(),
    toAccountId: z.string().uuid("toAccountId must be a valid UUID").optional(),
  }),
});
