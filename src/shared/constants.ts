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
  CONTACT: "Contact",
  SHARED_GROUP: "SharedGroup",
  SHARED_EXPENSE: "SharedExpense",
  SHARED_SETTLEMENT: "SharedSettlement",
  SHARED_INVITATION: "SharedInvitation",
  SHARED_COUNTERPARTY: "SharedCounterparty",
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

// R2-16c: INCOME budgets are goals; the MVP frontend only exposes EXPENSE.
export const BUDGET_TYPES = {
  EXPENSE: "EXPENSE",
  INCOME: "INCOME",
} as const;

export type BudgetType = keyof typeof BUDGET_TYPES;

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

// Each debt field belongs to the types that have it: a credit limit means nothing on a loan.
export const DEBT_ACCOUNT_FIELDS = {
  creditLimit: ["CARD", "OVERDRAFT"],
  borrowedAmount: ["LOAN"],
} as const satisfies Record<string, readonly AccountType[]>;

export type DebtAccountField = keyof typeof DEBT_ACCOUNT_FIELDS;

export const DEBT_ACCOUNT_FIELD_NAMES = Object.keys(
  DEBT_ACCOUNT_FIELDS,
) as DebtAccountField[];

export const TRANSACTION_TYPES = {
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
  TRANSFER: "TRANSFER",
  // Balance reconciliation: excluded from stats and budgets, no category.
  ADJUSTMENT: "ADJUSTMENT",
  // Money between you and a person: one account, no category, out of stats and budgets.
  SETTLEMENT: "SETTLEMENT",
} as const;

// Neither is spending: they move a balance without being money you earned or spent.
export const TYPES_OUTSIDE_SPENDING: readonly string[] = [
  TRANSACTION_TYPES.ADJUSTMENT,
  TRANSACTION_TYPES.SETTLEMENT,
];

// Recorded from Settle up and nowhere else, so the two write paths of a movement refuse it.
export const TYPES_RECORDED_ELSEWHERE: readonly string[] = [
  TRANSACTION_TYPES.SETTLEMENT,
];

export type TransactionType = keyof typeof TRANSACTION_TYPES;

// Server-derived, never client-settable. IMPORT is reserved for the bank/CSV import.
export const TRANSACTION_SOURCES = {
  MANUAL: "MANUAL",
  QUICK: "QUICK",
  IMPORT: "IMPORT",
} as const;

export type TransactionSource = keyof typeof TRANSACTION_SOURCES;

export const SPENDING_GROUP_BY = {
  category: "category",
  day: "day",
  month: "month",
  account: "account",
  tag: "tag",
} as const;

export type SpendingGroupBy = keyof typeof SPENDING_GROUP_BY;

export const SPENDING_SPLIT_BY = {
  category: "category",
} as const;

export type SpendingSplitBy = keyof typeof SPENDING_SPLIT_BY;

// A budget's own ceiling, and so the ceiling of every filter that exists to serve one.
export const MAX_BUDGET_CATEGORIES = 20;

// Published in the contract as SharedLimits: the sheet that adds one says it before a save fails.
export const MAX_CONTACTS_PER_USER = 200;
export const MAX_GROUP_PARTICIPANTS = 20;

// Sanity bound on an integer field, not a product rule: a guest block is one row whatever it counts.
export const MAX_EXPENSE_GUESTS = 999;

// Bounds what one inviter can put in strangers' Shared; published as SharedLimits.
export const MAX_PENDING_INVITATIONS_PER_USER = 50;
export const INVITATION_LIFETIME_DAYS = 30;

// An expired invitation is still PENDING: nothing wakes the server at that moment, so it is judged by its date.
export const INVITATION_STATUSES = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  WITHDRAWN: "WITHDRAWN",
  LEFT: "LEFT",
} as const;

export type InvitationStatus = keyof typeof INVITATION_STATUSES;

export const SPLIT_MODES = {
  EQUAL: "EQUAL",
  PERCENT: "PERCENT",
  EXACT: "EXACT",
  FIXED_REST: "FIXED_REST",
} as const;

export type SplitMode = keyof typeof SPLIT_MODES;

// A group default has no total to divide, so the two modes that need one cannot be one.
export const GROUP_SPLIT_MODES = {
  EQUAL: SPLIT_MODES.EQUAL,
  PERCENT: SPLIT_MODES.PERCENT,
} as const;

export type GroupSplitMode = keyof typeof GROUP_SPLIT_MODES;

// Why "counts as yours" was written. Splitting one and editing its split move no money, and say so.
export const SHARED_HISTORY_REASONS = {
  SPLIT: "SPLIT",
  SPLIT_EDITED: "SPLIT_EDITED",
  AMOUNT_CHANGED: "AMOUNT_CHANGED",
  UNSPLIT: "UNSPLIT",
  PAYMENT: "PAYMENT",
  REIMPUTED: "REIMPUTED",
  WRITE_OFF: "WRITE_OFF",
  WRITE_OFF_UNDONE: "WRITE_OFF_UNDONE",
} as const;

export type SharedHistoryReason = keyof typeof SHARED_HISTORY_REASONS;

// Derived on every read: a group is open until nobody owes anything in it.
export const GROUP_STATUSES = {
  OPEN: "OPEN",
  SETTLED: "SETTLED",
} as const;

export type GroupStatus = keyof typeof GROUP_STATUSES;

// Who a payment is with. A guest block is one of them, and it lives in a single expense.
export const SETTLEMENT_PARTIES = {
  CONTACT: "CONTACT",
  GUESTS: "GUESTS",
} as const;

export type SettlementPartyKind = keyof typeof SETTLEMENT_PARTIES;

export const SHARE_PARTIES = {
  USER: "USER",
  CONTACT: "CONTACT",
  GUESTS: "GUESTS",
} as const;

export type SharePartyKind = keyof typeof SHARE_PARTIES;

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
  // Separate secret for refresh tokens; falls back to JWT_SECRET when unset.
  REFRESH_SECRET: z.string().min(1).optional(),
  API_SECRET: z.string().optional(),
  JWT_EXPIRATION: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRATION: z.string().default("30d"),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(20).default(12),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  AUTH_EMAIL_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(50),
  AUTH_IP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
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
