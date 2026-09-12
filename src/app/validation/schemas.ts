import { z } from "zod";

import {
  ACCOUNT_TYPES,
  BUDGET_PERIOD_TYPES,
  BUDGET_TYPES,
  CATEGORY_TYPES,
  COLORS,
  MAX_BUDGET_CATEGORIES,
  SPENDING_GROUP_BY,
  SPENDING_SPLIT_BY,
  SpendingGroupBy,
  SpendingSplitBy,
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
  TransactionSource,
} from "../../shared/constants";
import { CATEGORY_ICONS } from "../../shared/icons";
import { Locale, LOCALES } from "../../shared/locale";
import { MAX_AMOUNT } from "../../shared/money";
import {
  MAX_LIMIT,
  SORT_FIELDS,
  SORT_ORDERS,
  SortField,
  SortOrder,
} from "../../shared/pagination";
import {
  describeSyncActions,
  SYNC_ENTITIES,
  SYNC_MAX_OPERATIONS,
} from "../../shared/syncBatch";
import { SYNC_MAX_LIMIT } from "../../shared/syncCursor";
import { isValidTimeZone } from "../../shared/timezone";

const timezoneField = z
  .string()
  .refine(isValidTimeZone, "Invalid IANA timezone")
  .optional();

// Stored as integer cents, so at most 2 decimals and within a sane bound (rejects 10.555 and 1e300).
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
const transactionSourceValues = Object.keys(TRANSACTION_SOURCES) as [
  TransactionSource,
  ...TransactionSource[],
];
const categoryTypeValues = Object.keys(CATEGORY_TYPES) as [string, ...string[]];
const colorValues = Object.keys(COLORS) as [string, ...string[]];
const budgetPeriodValues = Object.keys(BUDGET_PERIOD_TYPES) as [
  string,
  ...string[],
];
const budgetTypeValues = Object.keys(BUDGET_TYPES) as [string, ...string[]];
const spendingGroupByValues = Object.keys(SPENDING_GROUP_BY) as [
  SpendingGroupBy,
  ...SpendingGroupBy[],
];
const spendingSplitByValues = Object.keys(SPENDING_SPLIT_BY) as [
  SpendingSplitBy,
  ...SpendingSplitBy[],
];
// Bounded groupings only: a month window has months in it, and a user has a handful of accounts.
const SPLITTABLE_GROUPINGS: SpendingGroupBy[] = ["month", "account"];
const sortFieldValues = Object.keys(SORT_FIELDS) as [SortField, ...SortField[]];
const sortOrderValues = Object.keys(SORT_ORDERS) as [SortOrder, ...SortOrder[]];

// One place splits a comma-separated id list, so no controller can disagree with what was validated.
export const splitIdList = (value: string): string[] =>
  value.split(",").map((id) => id.trim());

const categoryIdList = z
  .string()
  .min(1, "categoryIds cannot be empty")
  .transform(splitIdList)
  .pipe(
    z
      .array(z.string().uuid("Each categoryId must be a valid UUID"))
      .max(
        MAX_BUDGET_CATEGORIES,
        `categoryIds must name at most ${MAX_BUDGET_CATEGORIES} categories`,
      ),
  )
  .optional();
const isoDate = z
  .string()
  .datetime({ offset: true, message: "Must be a valid ISO 8601 date" })
  .transform((s) => new Date(s));

// Offline clients mint the id so a create can be retried without duplicating.
const clientMintedId = z.string().uuid("id must be a valid UUID").optional();

// Optimistic concurrency: the `updatedAt` the client had, as the API prints it.
export const ifMatchHeader = z.string().datetime({
  offset: true,
  message: "If-Match must be the resource's updatedAt, in ISO 8601",
});

// Trim + casefold + dedupe, or the per-tag stats fragment into ghost buckets.
const normalizedTags = z
  .array(z.string().min(1).max(50))
  .max(30)
  .transform((tags) => [
    ...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  ])
  .optional();

const localeValues = Object.keys(LOCALES) as [Locale, ...Locale[]];
const localeField = z
  .enum(localeValues, {
    error: `Invalid locale. Available: ${localeValues.join(", ")}`,
  })
  .optional();

const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code")
  .optional();

// Normalized so Foo@x.com and foo@x.com resolve to the same account.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email format")
  .max(255);

// The index collation folds case and accents but not whitespace, so trimming happens here.
const accountName = z.string().trim().min(1, "Name is required").max(255);

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
      .transform(splitIdList)
      .pipe(
        z
          .array(z.string().uuid("Each ID must be a valid UUID"))
          .min(1)
          .max(100),
      )
      .optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
  }),
});

export const getTransactionsSchema = z.object({
  query: z
    .object({
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
        .transform(splitIdList)
        .pipe(
          z
            .array(z.string().uuid("Each ID must be a valid UUID"))
            .min(1)
            .max(100),
        )
        .optional(),
      accountId: z.string().uuid("accountId must be a valid UUID").optional(),
      categoryId: z.string().uuid("categoryId must be a valid UUID").optional(),
      categoryIds: categoryIdList,
      sort: z.enum(sortFieldValues).optional(),
      order: z.enum(sortOrderValues).optional(),
      type: z
        .enum(transactionTypeValues, {
          error: `Invalid transaction type. Available: ${transactionTypeValues.join(", ")}`,
        })
        .optional(),
      pendingDetails: z.enum(["true", "false"]).optional(),
      source: z
        .enum(transactionSourceValues, {
          error: `Invalid source. Available: ${transactionSourceValues.join(", ")}`,
        })
        .optional(),
      uncategorized: z.enum(["true", "false"]).optional(),
      from: z
        .string()
        .datetime({
          offset: true,
          message: "from must be a valid ISO 8601 date",
        })
        .optional(),
      to: z
        .string()
        .datetime({ offset: true, message: "to must be a valid ISO 8601 date" })
        .optional(),
      tag: z.string().min(1).max(50).optional(),
      includeSummary: z.enum(["true", "false"]).optional(),
    })
    .refine(
      (q) => !(q.uncategorized === "true" && q.categoryId !== undefined),
      {
        message: "uncategorized=true cannot be combined with categoryId",
        path: ["uncategorized"],
      },
    )
    .refine(
      (q) => !(q.uncategorized === "true" && q.categoryIds !== undefined),
      {
        message: "uncategorized=true cannot be combined with categoryIds",
        path: ["uncategorized"],
      },
    )
    .refine(
      (q) => !(q.categoryId !== undefined && q.categoryIds !== undefined),
      {
        message:
          "categoryId and categoryIds cannot be combined; use one of them",
        path: ["categoryIds"],
      },
    ),
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
      .transform(splitIdList)
      .pipe(
        z
          .array(z.string().uuid("Each ID must be a valid UUID"))
          .min(1)
          .max(100),
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
      // A hijacked 15-minute access token must not be able to swap the credentials.
      currentPassword: z.string().min(1).max(128).optional(),
      timezone: timezoneField,
      currency: currencyField,
      locale: localeField,
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
    id: clientMintedId,
    name: accountName,
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
      name: accountName.optional(),
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
    id: clientMintedId,
    name: z.string().min(1, "Name is required").max(255),
    icon: z
      .enum(CATEGORY_ICONS, {
        error: "Invalid icon. Must be one of the curated category icons",
      })
      .optional(),
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
      icon: z
        .enum(CATEGORY_ICONS, {
          error: "Invalid icon. Must be one of the curated category icons",
        })
        .optional()
        .nullable(),
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
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: "At least one field must be provided",
    }),
});

export const spendingStatsSchema = z.object({
  query: z
    .object({
      groupBy: z.enum(spendingGroupByValues).optional(),
      splitBy: z.enum(spendingSplitByValues).optional(),
      categoryIds: categoryIdList,
      type: z.enum(transactionTypeValues).optional(),
      from: z
        .string()
        .datetime({
          offset: true,
          message: "from must be a valid ISO 8601 date",
        })
        .optional(),
      to: z
        .string()
        .datetime({ offset: true, message: "to must be a valid ISO 8601 date" })
        .optional(),
    })
    .refine((q) => !q.from || !q.to || new Date(q.from) <= new Date(q.to), {
      message: "from must be before or equal to to",
      path: ["from"],
    })
    .refine(
      (q) =>
        q.splitBy === undefined ||
        SPLITTABLE_GROUPINGS.includes(q.groupBy as SpendingGroupBy),
      {
        message: `splitBy=category needs groupBy=${SPLITTABLE_GROUPINGS.join(" or ")}: every other grouping either is that dimension already, unwinds each row, or grows a split per row with the window`,
        path: ["splitBy"],
      },
    )
    .refine((q) => q.splitBy === undefined || (q.from && q.to), {
      message:
        "splitBy=category needs from and to: without a window it is every bucket of the history times every category",
      path: ["splitBy"],
    }),
});

// Every budget route resolves the period from `reference`, so all must validate it.
const budgetReferenceQuery = z.object({
  reference: z
    .string()
    .datetime({
      offset: true,
      message: "reference must be a valid ISO 8601 date",
    })
    .optional(),
});

export const getBudgetsSchema = z.object({
  query: budgetReferenceQuery.extend({
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    cursor: z.string().uuid("Cursor must be a valid UUID").optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
    includeExpired: z.enum(["true", "false"]).optional(),
  }),
});

export const budgetIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid("ID must be a valid UUID") }),
  query: budgetReferenceQuery,
});

export const createBudgetSchema = z.object({
  query: budgetReferenceQuery,
  body: z.object({
    id: clientMintedId,
    name: z.string().min(1, "Name is required").max(255),
    color: z.enum(colorValues, {
      error: `Invalid color. Available: ${colorValues.join(", ")}`,
    }),
    // Empty array = global budget: counts ALL expenses of the user.
    categoryIds: z
      .array(z.string().uuid("Each categoryId must be a valid UUID"))
      .max(MAX_BUDGET_CATEGORIES),
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
        .max(MAX_BUDGET_CATEGORIES)
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

/**
 * Restoring an archived resource whose name was taken meanwhile: renaming it in
 * the same request is the only way out that does not force the user to go and
 * edit the *other* resource first.
 */
// `cursor` wins over `since`: it can point inside an instant and `since` cannot.
export const syncChangesSchema = z.object({
  query: z.object({
    since: z
      .string()
      .datetime({
        offset: true,
        message: "since must be a valid ISO 8601 date",
      })
      .optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(SYNC_MAX_LIMIT, `Limit must be at most ${SYNC_MAX_LIMIT}`)
      .optional(),
  }),
});

/**
 * The offline outbox, pushed as one batch (O-B4). This validates the
 * ENVELOPE only: each operation's `payload.body` is checked inside the
 * service against the same Zod schema its HTTP route uses, so a bad body
 * rejects that one operation instead of the whole batch.
 */
const syncOperationSchema = z.object({
  opId: z.string().uuid("opId must be a valid UUID"),
  // The device's monotonic counter: the only ordering criterion (§2.8).
  seq: z.number().int("seq must be an integer").min(0),
  occurredAt: z.string().datetime({
    offset: true,
    message: "occurredAt must be a valid ISO 8601 date",
  }),
  entity: z.enum(SYNC_ENTITIES, {
    error: `Invalid entity. Available: ${SYNC_ENTITIES.join(", ")}`,
  }),
  action: z
    .string()
    .min(1)
    .max(40)
    .meta({ description: `Per entity — ${describeSyncActions()}` }),
  // The client-minted id of a create, the row's id otherwise.
  id: z.string().uuid("id must be a valid UUID"),
  payload: z
    .object({
      // The request body the matching HTTP route would take, verbatim.
      body: z.record(z.string(), z.unknown()).optional(),
      // `reference` for the budget routes that resolve a period.
      query: z
        .object({
          reference: z
            .string()
            .datetime({
              offset: true,
              message: "reference must be a valid ISO 8601 date",
            })
            .optional(),
        })
        .optional(),
    })
    .optional()
    .default({}),
  // The `If-Match` of the matching route: the updatedAt the device had.
  baseUpdatedAt: z
    .string()
    .datetime({
      offset: true,
      message: "baseUpdatedAt must be the resource's updatedAt, in ISO 8601",
    })
    .optional(),
  // Rows created offline that this names: if their create fails here, this comes back `blocked`.
  dependsOn: z
    .array(z.string().uuid("Each dependsOn entry must be a valid UUID"))
    .max(SYNC_MAX_OPERATIONS)
    .optional()
    .default([]),
  opVersion: z.number().int("opVersion must be an integer").min(1),
});

export const syncBatchSchema = z.object({
  body: z.object({
    operations: z
      .array(syncOperationSchema)
      .min(1, "operations must not be empty")
      .max(
        SYNC_MAX_OPERATIONS,
        `operations must have at most ${SYNC_MAX_OPERATIONS} entries`,
      )
      .refine((ops) => new Set(ops.map((op) => op.opId)).size === ops.length, {
        message: "operations must not repeat an opId",
      }),
  }),
});

export type SyncOperationInput = z.infer<typeof syncOperationSchema>;

export const restoreSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID must be a valid UUID"),
  }),
  body: z.object({ name: accountName.optional() }).optional().default({}),
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
    currency: currencyField,
    locale: localeField,
  }),
});

export const createTransactionSchema = z.object({
  body: z
    .object({
      id: clientMintedId,
      type: z.enum(transactionTypeValues, {
        error: `Invalid transaction type. Available: ${transactionTypeValues.join(", ")}`,
      }),
      amount: moneyAmount,
      date: z.string().datetime({
        offset: true,
        message: "Date must be a valid ISO 8601 date",
      }),
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
        .datetime({
          offset: true,
          message: "Date must be a valid ISO 8601 date",
        })
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

// ADJUSTMENT would create an un-detailable pendingDetails entry: it cannot take a category.
const quickAddTypeValues = Object.keys(TRANSACTION_TYPES).filter(
  (t) => t !== "ADJUSTMENT",
) as [string, ...string[]];

/**
 * Completing the review inbox: N cards saved in one request, each with its own
 * detail. Only detail fields — nothing here can move money, which is what makes
 * the per-item semantics safe.
 */
export const batchUpdateTransactionsSchema = z.object({
  body: z.object({
    items: z
      .array(
        z
          .object({
            id: z.string().uuid("id must be a valid UUID"),
            categoryId: z
              .string()
              .uuid("categoryId must be a valid UUID")
              .nullable()
              .optional(),
            description: z.string().max(255).nullable().optional(),
            pendingDetails: z.boolean().optional(),
          })
          .refine(
            (item) =>
              item.categoryId !== undefined ||
              item.description !== undefined ||
              item.pendingDetails !== undefined,
            { message: "Each item must change at least one field" },
          ),
      )
      .min(1, "items must not be empty")
      .max(100, "items must have at most 100 entries")
      .refine(
        (items) => new Set(items.map((i) => i.id)).size === items.length,
        { message: "items must not repeat an id", path: ["items"] },
      ),
  }),
});

export const quickAddTransactionSchema = z.object({
  body: z.object({
    id: clientMintedId,
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
