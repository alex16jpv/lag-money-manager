import swaggerJsdoc from "swagger-jsdoc";
import { z } from "zod";

import * as v from "../app/validation/schemas";
import {
  ACCOUNT_TYPES,
  BUDGET_PERIOD_TYPES,
  BUDGET_TYPES,
  CATEGORY_TYPES,
  COLORS,
  TRANSACTION_SOURCES,
  TRANSACTION_TYPES,
} from "../shared/constants";
import { LOCALES } from "../shared/locale";

// ---------------------------------------------------------------------------
// Request bodies: GENERATED from the Zod validation schemas (single source of
// truth). Never hand-write a request schema here — edit schemas.ts instead.
// ---------------------------------------------------------------------------

const toJson = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io: "input",
    unrepresentable: "any",
    override: ({ jsonSchema }) => {
      // .datetime() emits a screen-long ISO regex; format is enough for docs.
      if (jsonSchema.format && jsonSchema.pattern) delete jsonSchema.pattern;
    },
  }) as Record<string, unknown>;

const bodyOf = (schema: z.ZodObject): Record<string, unknown> =>
  toJson((schema.shape as { body: z.ZodType }).body);

const requestBodies = {
  RegisterInput: bodyOf(v.registerSchema),
  LoginInput: bodyOf(v.loginSchema),
  RefreshInput: bodyOf(v.refreshSchema),
  UpdateUserInput: bodyOf(v.updateUserSchema),
  CreateAccountInput: bodyOf(v.createAccountSchema),
  UpdateAccountInput: bodyOf(v.updateAccountSchema),
  CreateCategoryInput: bodyOf(v.createCategorySchema),
  UpdateCategoryInput: bodyOf(v.updateCategorySchema),
  CreateTransactionInput: bodyOf(v.createTransactionSchema),
  UpdateTransactionInput: bodyOf(v.updateTransactionSchema),
  QuickAddTransactionInput: bodyOf(v.quickAddTransactionSchema),
  CreateBudgetInput: bodyOf(v.createBudgetSchema),
  UpdateBudgetInput: bodyOf(v.updateBudgetSchema),
  BudgetAmountOverrideInput: bodyOf(v.budgetAmountOverrideSchema),
};

// ---------------------------------------------------------------------------
// Response views: hand-maintained mirrors of the entities/DTOs the API
// serializes. Enums come from constants.ts so they can never drift.
// ---------------------------------------------------------------------------

const uuid = { type: "string", format: "uuid" };
const dateTime = { type: "string", format: "date-time" };
const nullableDateTime = { ...dateTime, nullable: true };
// Decimal money (the API speaks decimals; storage is integer cents).
const money = { type: "number" };
const enumOf = (values: Record<string, string>): object => ({
  type: "string",
  enum: Object.keys(values),
});

const responseViews = {
  ErrorResponse: {
    type: "object",
    properties: {
      error: { type: "string", example: "NotFoundError" },
      message: { type: "string" },
      code: {
        type: "string",
        description:
          "Stable machine-readable code (e.g. RESOURCE_ARCHIVED, CURRENCY_MISMATCH). Branch on this, never on message.",
      },
      details: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    required: ["error", "message"],
  },
  Message: {
    type: "object",
    properties: { message: { type: "string" } },
  },
  Pagination: {
    type: "object",
    properties: {
      limit: { type: "integer" },
      offset: { type: "integer" },
      total: { type: "integer" },
      hasMore: { type: "boolean" },
      nextCursor: { ...uuid, nullable: true },
    },
  },
  User: {
    type: "object",
    properties: {
      id: uuid,
      name: { type: "string" },
      email: { type: "string", format: "email" },
      timezone: { type: "string", example: "America/Bogota" },
      currency: { type: "string", example: "COP" },
      locale: { ...enumOf(LOCALES), example: "en" },
      lastLoginAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
      reactivated: {
        type: "boolean",
        description:
          "Present (true) only when register revived a soft-deleted account.",
      },
    },
  },
  AuthTokens: {
    type: "object",
    properties: {
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
      user: { $ref: "#/components/schemas/User" },
    },
    required: ["accessToken", "refreshToken"],
  },
  Session: {
    type: "object",
    description: "One logged-in device (refresh-token rotation family).",
    properties: {
      id: uuid,
      createdAt: dateTime,
      lastUsedAt: dateTime,
      expiresAt: dateTime,
      userAgent: { type: "string" },
    },
  },
  Account: {
    type: "object",
    properties: {
      id: uuid,
      name: { type: "string" },
      type: enumOf(ACCOUNT_TYPES),
      balance: money,
      openingBalance: money,
      color: { ...enumOf(COLORS), nullable: true },
      userId: uuid,
      isDefault: { type: "boolean" },
      currency: { type: "string", example: "COP" },
      archivedAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  },
  Category: {
    type: "object",
    properties: {
      id: uuid,
      name: { type: "string" },
      icon: {
        type: "string",
        nullable: true,
        description: "Lucide icon key from the curated CATEGORY_ICONS set",
        example: "utensils",
      },
      color: { ...enumOf(COLORS), nullable: true },
      type: { ...enumOf(CATEGORY_TYPES), nullable: true },
      userId: uuid,
      seedKey: {
        type: "string",
        description: "Stable identity of a seeded default category.",
      },
      archivedAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  },
  Transaction: {
    type: "object",
    properties: {
      id: uuid,
      type: enumOf(TRANSACTION_TYPES),
      amount: money,
      date: dateTime,
      categoryId: { ...uuid, nullable: true },
      description: { type: "string", nullable: true },
      fromAccountId: { ...uuid, nullable: true },
      toAccountId: { ...uuid, nullable: true },
      userId: uuid,
      tags: { type: "array", items: { type: "string" } },
      note: { type: "string", nullable: true },
      pendingDetails: { type: "boolean" },
      source: {
        ...enumOf(TRANSACTION_SOURCES),
        description: "Server-derived; quick-add stamps QUICK.",
      },
      currency: { type: "string", example: "COP" },
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  },
  Budget: {
    type: "object",
    properties: {
      id: uuid,
      name: { type: "string" },
      color: enumOf(COLORS),
      categoryIds: {
        type: "array",
        items: uuid,
        description: "Empty array = global budget (all spending counts).",
      },
      archivedCategoryIds: {
        type: "array",
        items: uuid,
        description: "Subset of categoryIds the user archived.",
      },
      type: enumOf(BUDGET_TYPES),
      currency: { type: "string", example: "COP" },
      periodType: enumOf(BUDGET_PERIOD_TYPES),
      periodKey: { type: "string" },
      periodFrom: dateTime,
      periodTo: dateTime,
      baseAmount: money,
      amount: {
        ...money,
        description: "Resolved for the period: override ?? baseAmount.",
      },
      spent: money,
      hasOverride: { type: "boolean" },
      expired: {
        type: "boolean",
        description: "CUSTOM only: the fixed window already ended.",
      },
      effectiveFrom: dateTime,
      note: { type: "string", nullable: true },
      archivedAt: nullableDateTime,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  },
  StatsBucket: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description:
          "Category id, day (YYYY-MM-DD) or tag; 'uncategorized'/'untagged' for the catch-all buckets.",
      },
      total: money,
      count: { type: "integer" },
      avg: money,
    },
  },
  StatsResponse: {
    type: "object",
    properties: {
      groupBy: { type: "string", enum: ["category", "day", "tag"] },
      buckets: {
        type: "array",
        items: { $ref: "#/components/schemas/StatsBucket" },
      },
      total: {
        ...money,
        description:
          "Real total without double counting (multi-tag buckets can sum higher).",
      },
    },
  },
};

const listOf = (ref: string): object => ({
  type: "object",
  properties: {
    data: { type: "array", items: { $ref: `#/components/schemas/${ref}` } },
    pagination: { $ref: "#/components/schemas/Pagination" },
  },
});

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "lag-money-manager API",
      version: "1.0.0",
      description:
        "REST API for personal money management. Amounts are decimals with " +
        "at most 2 decimal places (stored as integer cents). Every monetary " +
        "resource carries the user's `currency` (ISO 4217). Errors carry a " +
        "stable machine-readable `code`. Mutating a create twice is safe " +
        "with the `Idempotency-Key` header on POST /transactions[/quick].",
    },
    servers: [{ url: "/", description: "Current server" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        ...requestBodies,
        ...responseViews,
        AccountList: listOf("Account"),
        CategoryList: listOf("Category"),
        TransactionList: listOf("Transaction"),
        BudgetList: listOf("Budget"),
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/app/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
