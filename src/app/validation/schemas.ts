import { z } from "zod";

import { ACCOUNT_TYPES, COLORS, TRANSACTION_TYPES } from "../../shared/constants";
import { MAX_AMOUNT } from "../../shared/money";
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
const categoryTypeValues = Object.keys(TRANSACTION_TYPES) as [string, ...string[]];
const colorValues = Object.keys(COLORS) as [string, ...string[]];

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
    type: z
      .enum(transactionTypeValues, {
        error: `Invalid transaction type. Available: ${transactionTypeValues.join(", ")}`,
      })
      .optional(),
    pendingDetails: z.enum(["true", "false"]).optional(),
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
      email: z.string().email("Invalid email format").max(255).optional(),
      password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .max(128)
        .optional(),
    })
    .refine(
      (data) =>
        data.name !== undefined ||
        data.email !== undefined ||
        data.password !== undefined,
      {
        message: "At least one field (name, email, password) must be provided",
      },
    ),
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
    emoji: z.string().max(8, "Emoji must be at most 8 characters").optional(),
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
      emoji: z.string().max(8, "Emoji must be at most 8 characters").optional(),
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
  query: z.object({
    groupBy: z.enum(["category", "day", "tag"]).optional(),
    type: z.enum(transactionTypeValues).optional(),
    from: z
      .string()
      .datetime({ message: "from must be a valid ISO 8601 date" })
      .optional(),
    to: z
      .string()
      .datetime({ message: "to must be a valid ISO 8601 date" })
      .optional(),
  }),
});

export const idParamSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID must be a valid UUID"),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format"),
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
    email: z.string().email("Invalid email format").max(255),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128),
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
        .datetime({ message: "Date must be a valid ISO 8601 date" }),
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
      tags: z.array(z.string().min(1).max(50)).max(30).optional(),
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
        .datetime({ message: "Date must be a valid ISO 8601 date" })
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
      tags: z.array(z.string().min(1).max(50)).max(30).optional(),
      note: z.string().max(1000).optional().nullable(),
      pendingDetails: z.boolean().optional(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: "At least one field must be provided",
    }),
});

export const quickAddTransactionSchema = z.object({
  body: z.object({
    amount: moneyAmount,
    type: z.enum(transactionTypeValues).optional(),
    date: z
      .string()
      .datetime({ message: "Date must be a valid ISO 8601 date" })
      .optional(),
    categoryId: z.string().uuid("categoryId must be a valid UUID").optional(),
    fromAccountId: z
      .string()
      .uuid("fromAccountId must be a valid UUID")
      .optional(),
    toAccountId: z.string().uuid("toAccountId must be a valid UUID").optional(),
  }),
});
