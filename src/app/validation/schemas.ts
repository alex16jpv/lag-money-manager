import { z } from "zod";
import { ACCOUNT_TYPES, TRANSACTION_TYPES } from "../../shared/constants";

const accountTypeValues = Object.keys(ACCOUNT_TYPES) as [string, ...string[]];
const transactionTypeValues = Object.keys(TRANSACTION_TYPES) as [
  string,
  ...string[],
];

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required").max(255),
    email: z.string().email("Invalid email format").max(255),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128),
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
    balance: z.number().finite("Balance must be a finite number").default(0),
    userId: z.string().uuid("userId must be a valid UUID"),
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
      balance: z.number().finite("Balance must be a finite number").optional(),
      userId: z.string().uuid("userId must be a valid UUID").optional(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: "At least one field must be provided",
    }),
});

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required").max(255),
  }),
});

export const updateCategorySchema = z.object({
  params: z.object({
    id: z.string().uuid("ID must be a valid UUID"),
  }),
  body: z
    .object({
      name: z.string().min(1).max(255).optional(),
    })
    .refine((data) => data.name !== undefined, {
      message: "At least one field (name) must be provided",
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
      amount: z.number().positive("Amount must be greater than 0"),
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
      userId: z.string().uuid("userId must be a valid UUID"),
      tags: z.string().max(500).optional().nullable(),
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
      amount: z.number().positive("Amount must be greater than 0").optional(),
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
      userId: z.string().uuid("userId must be a valid UUID").optional(),
      tags: z.string().max(500).optional().nullable(),
      note: z.string().max(1000).optional().nullable(),
    })
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: "At least one field must be provided",
    }),
});
