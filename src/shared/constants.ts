export const DB_TYPES = {
  SEQ: "SEQ",
  MONGO: "MONGO",
  LOCAL_STORAGE: "LOCAL_STORAGE",
} as const;

export type DbType = keyof typeof DB_TYPES;

export const MODEL_NAMES = {
  USER: "User",
  ACCOUNT: "Account",
  TRANSACTION: "Transaction",
  BUDGET: "Budget",
  CATEGORY: "Category",
} as const;

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
} as const;

export type TransactionType = keyof typeof TRANSACTION_TYPES;

export type CategoryType = keyof typeof TRANSACTION_TYPES;

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
  DB_TYPE: z.string().default(DB_TYPES.SEQ),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  API_SECRET: z.string().optional(),
  JWT_EXPIRATION: z.string().default("24h"),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(20).default(12),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(200),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

const seqEnvSchema = baseEnvSchema.extend({
  SEQ_PORT: z.coerce.number().default(3306),
  SEQ_HOST: z.string().min(1, "SEQ_HOST is required"),
  SEQ_DATABASE: z.string().min(1, "SEQ_DATABASE is required"),
  SEQ_USERNAME: z.string().min(1, "SEQ_USERNAME is required"),
  SEQ_PASSWORD: z.string().min(1, "SEQ_PASSWORD is required"),
  SEQ_POOL_MAX: z.coerce.number().int().min(1).default(20),
  SEQ_POOL_MIN: z.coerce.number().int().min(0).default(5),
  SEQ_POOL_ACQUIRE: z.coerce.number().int().min(1000).default(30000),
  SEQ_POOL_IDLE: z.coerce.number().int().min(1000).default(10000),
});

const mongoEnvSchema = baseEnvSchema.extend({
  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
});

export const ENVIRONMENT =
  process.env.DB_TYPE === DB_TYPES.MONGO
    ? mongoEnvSchema.parse(process.env)
    : seqEnvSchema.parse(process.env);

// True when running inside AWS Lambda (the runtime sets this variable).
export const IS_LAMBDA = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
