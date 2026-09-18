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

export type SkipReason =
  "ARCHIVED" | "ALREADY_CORRECTED" | "NO_CREDIT_LIMIT" | "NOT_IN_POSITIVE";

export const SKIP_REASONS: Record<SkipReason, string> = {
  ARCHIVED: "archived: left untouched",
  ALREADY_CORRECTED: "already corrected by this script",
  NO_CREDIT_LIMIT: "no credit limit: set one with «Set a credit limit»",
  NOT_IN_POSITIVE: "not carried in positive: already reads as debt",
};

export interface CardFix {
  card: CardRow;
  creditLimit: number;
  balanceAfter: number;
}

export interface CardSkip {
  card: CardRow;
  reason: SkipReason;
}

export interface IncomeFix {
  income: IncomeRow;
  card: CardRow;
}

export interface Plan {
  fixes: CardFix[];
  skipped: CardSkip[];
  incomes: IncomeFix[];
  unmatchedIncomes: IncomeRow[];
}

function skipReasonOf(card: CardRow): SkipReason | null {
  if (card.archivedAt) return "ARCHIVED";
  if (card.corrected) return "ALREADY_CORRECTED";
  if (!card.creditLimit || card.creditLimit <= 0) return "NO_CREDIT_LIMIT";
  if (card.balance <= 0) return "NOT_IN_POSITIVE";
  return null;
}

export function planCardBaseline(cards: CardRow[], incomes: IncomeRow[]): Plan {
  const fixes: CardFix[] = [];
  const skipped: CardSkip[] = [];

  for (const card of cards) {
    const reason = skipReasonOf(card);
    if (reason) {
      skipped.push({ card, reason });
      continue;
    }
    const creditLimit = card.creditLimit as number;
    fixes.push({
      card,
      creditLimit,
      balanceAfter: card.balance - creditLimit,
    });
  }

  const byId = new Map(cards.map((card) => [card.id, card]));
  const incomeFixes: IncomeFix[] = [];
  const unmatchedIncomes: IncomeRow[] = [];
  for (const income of incomes) {
    const card = byId.get(income.toAccountId);
    if (card) {
      incomeFixes.push({ income, card });
    } else {
      unmatchedIncomes.push(income);
    }
  }

  return { fixes, skipped, incomes: incomeFixes, unmatchedIncomes };
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
  names: string[],
  database: string,
): BackupFile | null {
  let latest: BackupFile | null = null;
  for (const name of names) {
    const at = parseBackupName(name, database);
    if (!at) continue;
    if (!latest || at.getTime() > latest.at.getTime()) {
      latest = { name, at };
    }
  }
  return latest;
}

export function backupAgeHours(at: Date, now: Date): number {
  return (now.getTime() - at.getTime()) / 3_600_000;
}
