export const DB_TYPES = {
  SEQ: "SEQ",
  MONGO: "MONGO",
  LOCAL_STORAGE: "LOCAL_STORAGE",
};

export const MODEL_NAMES = {
  USER: "User",
  ACCOUNT: "Account",
  TRANSACTION: "Transaction",
  BUDGET: "Budget",
  CATEGORY: "Category",
};

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
};

export const TRANSACTION_TYPES = {
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
  TRANSFER: "TRANSFER",
};

import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DB_TYPE: z.string().default(DB_TYPES.SEQ),
  SEQ_PORT: z.coerce.number().default(3306),
  SEQ_HOST: z.string().min(1, "SEQ_HOST is required"),
  SEQ_DATABASE: z.string().min(1, "SEQ_DATABASE is required"),
  SEQ_USERNAME: z.string().min(1, "SEQ_USERNAME is required"),
  SEQ_PASSWORD: z.string().min(1, "SEQ_PASSWORD is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
});

export const ENVIRONMENT = envSchema.parse(process.env);
