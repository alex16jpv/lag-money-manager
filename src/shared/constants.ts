export const DB_TYPES = {
  MONGO: "MONGO",
} as const;

export type DbType = keyof typeof DB_TYPES;

export const MODEL_NAMES = {
  USER: "User",
  ACCOUNT: "Account",
  TRANSACTION: "Transaction",
  CATEGORY: "Category",
  BUDGET: "Budget",
} as const;

export const BUDGET_PERIOD_TYPES = {
  WEEKLY: "WEEKLY",
  BIWEEKLY: "BIWEEKLY",
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  YEARLY: "YEARLY",
  CUSTOM: "CUSTOM",
} as const;

export type BudgetPeriodType = keyof typeof BUDGET_PERIOD_TYPES;

export const ACCOUNT_TYPES = {
  CASH: "CASH",
  ACCOUNT: "ACCOUNT",
  CARD: "CARD",
  DEBIT_CARD: "DEBIT_CARD",
  SAVINGS: "SAVINGS",
  INVESTMENT: "INVESTMENT",
  OVERDRAFT: "OVERDRAFT",
  LOAN: "LOAN",
  OTHER: "OTHER",
} as const;

export type AccountType = keyof typeof ACCOUNT_TYPES;

export const TRANSACTION_TYPES = {
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
  TRANSFER: "TRANSFER",
  // Balance reconciliation: excluded from stats and budgets, no category.
  ADJUSTMENT: "ADJUSTMENT",
} as const;

export type TransactionType = keyof typeof TRANSACTION_TYPES;

export const CATEGORY_TYPES = {
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
  TRANSFER: "TRANSFER",
} as const;

export type CategoryType = keyof typeof CATEGORY_TYPES;

export const COLORS = {
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
} as const;

export type Color = keyof typeof COLORS;

import { z } from "zod";

const baseEnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DB_TYPE: z.string().default(DB_TYPES.MONGO),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  API_SECRET: z.string().optional(),
  JWT_EXPIRATION: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRATION: z.string().default("30d"),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(20).default(12),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(200),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

const mongoEnvSchema = baseEnvSchema.extend({
  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
});

export const ENVIRONMENT = mongoEnvSchema.parse(process.env);

// True when running inside AWS Lambda (the runtime sets this variable).
export const IS_LAMBDA = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
