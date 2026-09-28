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

export const EMAIL_PROVIDER_NAMES = {
  ses: "ses",
  mailpit: "mailpit",
} as const;

export type EmailProviderName = keyof typeof EMAIL_PROVIDER_NAMES;

export const EMAIL_DELIVERY_STATUSES = {
  sent: "sent",
  failed: "failed",
  limited: "limited",
  disabled: "disabled",
  suppressed: "suppressed",
  delivered: "delivered",
  bounced: "bounced",
  complained: "complained",
} as const;

export type EmailDeliveryStatus = keyof typeof EMAIL_DELIVERY_STATUSES;

export const EMAIL_EVENT_KINDS = {
  delivered: "delivered",
  bounced: "bounced",
  complained: "complained",
} as const;

export type EmailEventKind = keyof typeof EMAIL_EVENT_KINDS;

export const EMAIL_SUPPRESSION_REASONS = {
  bounce: "bounce",
  complaint: "complaint",
} as const;

export type EmailSuppressionReason = keyof typeof EMAIL_SUPPRESSION_REASONS;

export const AUTH_CODE_PURPOSES = {
  reset: "reset",
  verify: "verify",
  "email-change": "email-change",
} as const;

export type AuthCodePurpose = keyof typeof AUTH_CODE_PURPOSES;

// The "It wasn't me" link's token: 72 bytes in base64url (src/app/services/authCodes.ts).
export const NOT_ME_TOKEN_FORMAT = /^[A-Za-z0-9_-]{96}$/;

// The "Undo the change" link's token: 48 bytes in base64url (src/app/services/authCodes.ts).
export const UNDO_TOKEN_FORMAT = /^[A-Za-z0-9_-]{64}$/;

// Cloudflare's published test secrets: they pass, fail or report a spent token whatever the token is.
export const TURNSTILE_TEST_SECRET = /^[123]x0{31}AA$/;

// The second group is the topic's region, which its signing certificate's host must match.
export const SNS_TOPIC_ARN =
  /^arn:aws[a-z-]*:sns:([a-z0-9-]+):\d{12}:[A-Za-z0-9_-]{1,256}$/;

import { z } from "zod";

import { emailBudgetSlices } from "./emailBudgets";

const envFlagDefaulting = (
  fallback: "true" | "false",
): z.ZodType<boolean, string | undefined> =>
  z
    .string()
    .default(fallback)
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(["true", "false", "1", "0"]))
    .transform((value) => value === "true" || value === "1");

const envFlag = envFlagDefaulting("true");

const emailProviderList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(EMAIL_PROVIDER_NAMES)));

const emailEnvSchema = z.object({
  EMAIL_PROVIDERS: emailProviderList,
  EMAIL_SENDING_ENABLED: envFlag,
  EMAIL_VERIFICATION_REQUIRED: envFlagDefaulting("false"),
  EMAIL_FROM_NAME: z
    .string()
    .regex(
      /^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/,
      "printable ASCII without quotes or backslashes: it goes quoted into a mail header",
    )
    .default("Ledger Flow"),
  EMAIL_FROM_ADDRESS: z.email().default("no-reply@ledgerflow.alexpiral.com"),
  EMAIL_REPLY_TO: z.email().default("ledgerflow@alexpiral.com"),
  APP_URL: z.url().default("https://ledgerflow.alexpiral.com"),
  EMAIL_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(100).default(1500),
  EMAIL_SES_REGION: z.string().min(1).optional(),
  EMAIL_SES_CONFIGURATION_SET: z.string().min(1).optional(),
  EMAIL_SES_EVENTS_TOPIC_ARN: z
    .string()
    .regex(
      SNS_TOPIC_ARN,
      "must be the ARN of the SNS topic SES publishes its events to",
    )
    .optional(),
  MAILPIT_URL: z.url().default("http://localhost:8025"),
  EMAIL_DAILY_CAP: z.coerce.number().int().min(1).default(300),
  EMAIL_MONTHLY_CAP: z.coerce.number().int().min(1).default(9000),
  EMAIL_RESET_SHARE_PERCENT: z.coerce.number().int().min(1).max(98).default(30),
  EMAIL_OTHER_SHARE_PERCENT: z.coerce.number().int().min(0).max(98).default(20),
  EMAIL_ADDRESS_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(60),
  EMAIL_ADDRESS_DAILY_MAX: z.coerce.number().int().min(1).default(5),
  EMAIL_USER_DAILY_MAX: z.coerce.number().int().min(1).default(5),
  EMAIL_DEVICE_HOURLY_MAX: z.coerce.number().int().min(1).default(10),
  EMAIL_IP_HOURLY_MAX: z.coerce.number().int().min(1).default(5),
});

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
  TURNSTILE_SECRET: z.string().min(1).optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

const mongoEnvSchema = baseEnvSchema
  .extend(emailEnvSchema.shape)
  .extend({
    MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_RESET_SHARE_PERCENT + env.EMAIL_OTHER_SHARE_PERCENT >= 100) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_OTHER_SHARE_PERCENT"],
        message:
          "EMAIL_RESET_SHARE_PERCENT + EMAIL_OTHER_SHARE_PERCENT must leave a share for verification and security",
      });
    }
    for (const cap of ["EMAIL_DAILY_CAP", "EMAIL_MONTHLY_CAP"] as const) {
      const slices = emailBudgetSlices(
        env[cap],
        env.EMAIL_RESET_SHARE_PERCENT,
        env.EMAIL_OTHER_SHARE_PERCENT,
      );
      if (slices.reset < 1 || slices.security < 1) {
        ctx.addIssue({
          code: "custom",
          path: [cap],
          message: `${cap} is too low: its reset or security share rounds down to no email at all`,
        });
      }
    }
    if (env.NODE_ENV !== "production") return;
    if (env.EMAIL_PROVIDERS.includes(EMAIL_PROVIDER_NAMES.mailpit)) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDERS"],
        message: "mailpit only catches mail on a developer's machine",
      });
    }
    if (
      env.EMAIL_PROVIDERS.includes(EMAIL_PROVIDER_NAMES.ses) &&
      !env.EMAIL_SES_EVENTS_TOPIC_ARN
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_SES_EVENTS_TOPIC_ARN"],
        message:
          "sending through SES needs its bounces and complaints: set the topic they are published to",
      });
    }
    if (
      env.TURNSTILE_SECRET &&
      TURNSTILE_TEST_SECRET.test(env.TURNSTILE_SECRET)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["TURNSTILE_SECRET"],
        message:
          "Cloudflare's test secret lets any request through the captcha",
      });
    }
    if (env.EMAIL_VERIFICATION_REQUIRED && env.EMAIL_PROVIDERS.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_VERIFICATION_REQUIRED"],
        message:
          "invitations would wait for a confirmation nobody can receive: set EMAIL_PROVIDERS first",
      });
    }
    if (env.EMAIL_PROVIDERS.length > 0 && !env.TURNSTILE_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["TURNSTILE_SECRET"],
        message:
          "sending email needs the captcha that keeps strangers from spending it: set the Turnstile secret",
      });
    }
    if (!env.APP_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "every link in an email must be https in production",
      });
    }
  });

export const ENVIRONMENT = mongoEnvSchema.parse(process.env);

// True when running inside AWS Lambda (the runtime sets this variable).
export const IS_LAMBDA = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
