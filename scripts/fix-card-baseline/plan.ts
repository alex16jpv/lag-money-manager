import { AccountType, DEBT_ACCOUNT_FIELDS } from "../../src/shared/constants";

export const CORRECTION_DESCRIPTION = "Credit limit removed from balance";

export const LIMIT_ACCOUNT_TYPES: readonly AccountType[] =
  DEBT_ACCOUNT_FIELDS.creditLimit;

export interface CardRow {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: number;
  creditLimit: number | null;
  archivedAt: Date | null;
  corrected: boolean;
}

export interface IncomeRow {
  id: string;
  date: Date;
  amount: number;
  description: string | null;
  categoryId: string | null;
  toAccountId: string;
}

export type CardSkipReason =
  "ARCHIVED" | "ALREADY_CORRECTED" | "NO_CREDIT_LIMIT" | "AMBIGUOUS_BALANCE";

export const CARD_SKIP_REASONS: Record<CardSkipReason, string> = {
  ARCHIVED: "archived: left untouched",
  ALREADY_CORRECTED: "already corrected by this script",
  NO_CREDIT_LIMIT: "no credit limit: set one with «Set a credit limit»",
  AMBIGUOUS_BALANCE:
    "balance is not positive: a card at or past its limit looks the same as one that already reads as debt — decide this one yourself",
};

export type IncomeSkipReason = "ARCHIVED" | "UNKNOWN_ACCOUNT";

export const INCOME_SKIP_REASONS: Record<IncomeSkipReason, string> = {
  ARCHIVED: "its card is archived: a transaction cannot be rebooked on it",
  UNKNOWN_ACCOUNT: "its account is not one of this user's cards",
};

export interface CardFix {
  card: CardRow;
  creditLimit: number;
  balanceAfter: number;
}

export interface CardSkip {
  card: CardRow;
  reason: CardSkipReason;
}

export interface IncomeFix {
  income: IncomeRow;
  card: CardRow;
}

export interface IncomeSkip {
  income: IncomeRow;
  reason: IncomeSkipReason;
}

export interface Plan {
  fixes: CardFix[];
  skippedCards: CardSkip[];
  incomes: IncomeFix[];
  skippedIncomes: IncomeSkip[];
}

function cardSkipReason(card: CardRow): CardSkipReason | null {
  if (card.archivedAt) return "ARCHIVED";
  if (card.corrected) return "ALREADY_CORRECTED";
  if (!card.creditLimit || card.creditLimit <= 0) return "NO_CREDIT_LIMIT";
  if (card.balance <= 0) return "AMBIGUOUS_BALANCE";
  return null;
}

export function planCardBaseline(cards: CardRow[], incomes: IncomeRow[]): Plan {
  const fixes: CardFix[] = [];
  const skippedCards: CardSkip[] = [];

  for (const card of cards) {
    const reason = cardSkipReason(card);
    if (reason) {
      skippedCards.push({ card, reason });
      continue;
    }
    const creditLimit = card.creditLimit as number;
    fixes.push({ card, creditLimit, balanceAfter: card.balance - creditLimit });
  }

  const byId = new Map(cards.map((card) => [card.id, card]));
  const incomeFixes: IncomeFix[] = [];
  const skippedIncomes: IncomeSkip[] = [];
  for (const income of incomes) {
    const card = byId.get(income.toAccountId);
    if (!card) {
      skippedIncomes.push({ income, reason: "UNKNOWN_ACCOUNT" });
    } else if (card.archivedAt) {
      skippedIncomes.push({ income, reason: "ARCHIVED" });
    } else {
      incomeFixes.push({ income, card });
    }
  }

  return { fixes, skippedCards, incomes: incomeFixes, skippedIncomes };
}

export interface Args {
  email: string;
  apply: boolean;
}

export function parseArgs(argv: string[]): Args | string {
  let email = "";
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length).trim();
    } else {
      return `Unknown argument: ${arg}`;
    }
  }
  if (!email) {
    return "--email is required: this repair is scoped to a single user.";
  }
  return { email: email.toLowerCase(), apply };
}

export function databaseFromUri(uri: string): string | null {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  if (withoutScheme === uri) return null;
  const withoutCredentials = withoutScheme.replace(/^[^@/]*@/, "");
  const path = withoutCredentials.split("?")[0];
  const slash = path.indexOf("/");
  if (slash === -1) return null;
  const database = path.slice(slash + 1);
  return /^[A-Za-z0-9_-]+$/.test(database) ? database : null;
}

export interface BackupFile {
  name: string;
  size: number;
  at: Date;
}

export function parseBackupName(name: string, database: string): Date | null {
  if (!/^[A-Za-z0-9_-]+$/.test(database)) return null;
  const match = new RegExp(
    `^${database}-(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})Z\\.archive\\.gz$`,
  ).exec(name);
  if (!match) return null;
  const at = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function latestBackup(
  files: { name: string; size: number }[],
  database: string,
): BackupFile | null {
  let latest: BackupFile | null = null;
  for (const file of files) {
    const at = parseBackupName(file.name, database);
    if (!at) continue;
    if (!latest || at.getTime() > latest.at.getTime()) {
      latest = { name: file.name, size: file.size, at };
    }
  }
  return latest;
}

export function backupAgeHours(at: Date, now: Date): number {
  return (now.getTime() - at.getTime()) / 3_600_000;
}

export type BackupVerdict =
  | { ok: true; backup: BackupFile; ageHours: number }
  | { ok: false; backup: BackupFile | null; ageHours: number; why: string };

export function judgeBackup(
  files: { name: string; size: number }[],
  database: string,
  now: Date,
  maxAgeHours: number,
): BackupVerdict {
  const backup = latestBackup(files, database);
  if (!backup) {
    return {
      ok: false,
      backup: null,
      ageHours: 0,
      why: `no archive of '${database}' here`,
    };
  }
  const ageHours = backupAgeHours(backup.at, now);
  if (backup.size <= 0) {
    return { ok: false, backup, ageHours, why: "the newest archive is empty" };
  }
  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      backup,
      ageHours,
      why: `the newest archive is older than ${maxAgeHours} h`,
    };
  }
  return { ok: true, backup, ageHours };
}
