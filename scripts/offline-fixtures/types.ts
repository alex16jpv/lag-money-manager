/**
 * Shapes of `auditoria/offline-fixtures/*.json` — the parity contract between
 * the backend's aggregations and the frontend's local derivations (O-B6/O-F3).
 *
 * Two layers live here. The `Scenario*` types are how a scenario is authored
 * (by key, so a human can read it); the `Fixture*` types are what is written
 * out (by id, in the shape the mirror holds, so the frontend can feed the file
 * straight into `derive`).
 */

export type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER" | "ADJUSTMENT";
export type MoneyType = "EXPENSE" | "INCOME";
export type GroupBy = "day" | "category" | "tag";
export type PeriodType =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "YEARLY"
  | "CUSTOM";

/* ---------- authored form ---------- */

export interface ScenarioAccount {
  key: string;
  name: string;
  type: string;
  color?: string;
  /** Balance before the first transaction. The final balance is derived. */
  openingBalance: number;
  isDefault?: boolean;
  archived?: boolean;
}

export interface ScenarioCategory {
  key: string;
  name: string;
  type: MoneyType;
  archived?: boolean;
}

export interface ScenarioTransaction {
  key: string;
  type: TransactionType;
  amount: number;
  /** ISO 8601 with the offset the user would have typed it in. */
  date: string;
  description?: string;
  category?: string;
  from?: string;
  to?: string;
  tags?: string[];
  /** Quick-add: no category, `pendingDetails`, charged to the default account. */
  quick?: boolean;
  deleted?: boolean;
  /** Why this row is in the fixture. Travels to the JSON. */
  note?: string;
}

export interface ScenarioBudget {
  key: string;
  name: string;
  type?: MoneyType;
  categories: string[];
  amount: number;
  periodType: PeriodType;
  periodStartDate?: string;
  periodEndDate?: string;
  effectiveFrom?: string;
  /** Amount for the period the reference instant falls in. */
  override?: number;
  archived?: boolean;
  note?: string;
}

export interface ScenarioSpendingQuery {
  name: string;
  groupBy: GroupBy;
  /** Omitted on purpose in some queries: the server then means "all but ADJUSTMENT". */
  type?: TransactionType;
  from: string;
  to: string;
  note?: string;
}

export interface Scenario {
  id: string;
  title: string;
  /** What this scenario pins down, in one line each. */
  pins: string[];
  user: { id: string; timezone: string; currency: string; minorUnits: number };
  /** The instant every budget window resolves at. */
  reference: string;
  accounts: ScenarioAccount[];
  categories: ScenarioCategory[];
  transactions: ScenarioTransaction[];
  budgets: ScenarioBudget[];
  spending: ScenarioSpendingQuery[];
}

/* ---------- written form ---------- */

export interface FixtureAccount {
  key: string;
  id: string;
  name: string;
  type: string;
  color?: string;
  currency: string;
  openingBalance: number;
  isDefault: boolean;
  archivedAt: string | null;
}

export interface FixtureCategory {
  key: string;
  id: string;
  name: string;
  type: MoneyType;
  archivedAt: string | null;
}

export interface FixtureTransaction {
  key: string;
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  description: string | null;
  categoryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  tags: string[];
  currency: string;
  source: "MANUAL" | "QUICK";
  pendingDetails: boolean;
  deletedAt: string | null;
  note?: string;
}

/** As STORED, which is what `GET /sync/changes` sends (O-B3): no view fields. */
export interface FixtureBudget {
  key: string;
  id: string;
  name: string;
  type: MoneyType;
  categoryIds: string[];
  amount: number;
  amountOverrides: Record<string, number>;
  currency: string;
  periodType: PeriodType;
  periodStartDate: string | null;
  periodEndDate: string | null;
  effectiveFrom: string | null;
  archivedAt: string | null;
  note?: string;
}

export interface ExpectedBucket {
  key: string;
  total: number;
  count: number;
  avg: number;
}

export interface ExpectedSpending {
  name: string;
  query: {
    groupBy: GroupBy;
    type: TransactionType | null;
    from: string;
    to: string;
    timezone: string;
  };
  total: number;
  buckets: ExpectedBucket[];
  note?: string;
}

export interface ExpectedBudgetView {
  key: string;
  id: string;
  periodKey: string;
  periodFrom: string;
  periodTo: string;
  baseAmount: number;
  amount: number;
  hasOverride: boolean;
  spent: number;
  expired: boolean;
  archivedCategoryIds: string[];
}

export interface Fixture {
  id: string;
  title: string;
  pins: string[];
  generatedBy: string;
  user: Scenario["user"];
  accounts: FixtureAccount[];
  categories: FixtureCategory[];
  transactions: FixtureTransaction[];
  budgets: FixtureBudget[];
  expected: {
    balances: { key: string; accountId: string; balance: number }[];
    pending: { count: number; total: number; transactionIds: string[] };
    spending: ExpectedSpending[];
    budgets: { reference: string; views: ExpectedBudgetView[] };
  };
}
