/**
 * Shapes of `fixtures/offline/*.json` — the parity contract between
 * the backend's aggregations and the frontend's local derivations (O-B6/O-F3).
 *
 * The enums below repeat the API's on purpose. This whole directory is a second
 * reading of the rules and imports nothing from `src/`: a fixture that shared
 * the app's constants would agree with it by construction, which is the one
 * thing it must not do.
 *
 * Two layers live here. The `Scenario*` types are how a scenario is authored
 * (by key, so a human can read it); the `Fixture*` types are what is written
 * out (by id, in the shape the mirror holds, so the frontend can feed the file
 * straight into `derive`).
 */

export type TransactionType =
  "EXPENSE" | "INCOME" | "TRANSFER" | "ADJUSTMENT" | "SETTLEMENT";
export type SplitMode = "EQUAL" | "PERCENT" | "EXACT" | "FIXED_REST";
export type PartyKind = "USER" | "CONTACT" | "GUESTS";
/**
 * Where one party stands, derived from the money except the last one, which is
 * a decision: `NOT_PAID` nothing of theirs has come back, `PARTIALLY_PAID`
 * some has and something is still open, `PAID` nothing is left open (paying
 * ahead reads the same, with the excess in `surplus`), and `WRITTEN_OFF` you
 * gave up on what was open — the only one no figure can produce on its own.
 */
export type PersonState =
  "NOT_PAID" | "PARTIALLY_PAID" | "PAID" | "WRITTEN_OFF";
export type MoneyType = "EXPENSE" | "INCOME";
/** A category can also belong to a transfer; a budget cannot be of transfers. */
export type CategoryType = MoneyType | "TRANSFER";
export type GroupBy = "day" | "month" | "category" | "account" | "tag";
export type SplitBy = "category";
export type SortField = "date" | "amount";
export type SortOrder = "asc" | "desc";
export type PeriodType =
  "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM";

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
  type: CategoryType;
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

export interface ScenarioShare {
  /** A contact key, or "you"; "guests" is the block whose head count is on the expense. */
  party: string;
  percent?: number;
  fixedAmount?: number;
}

export interface ScenarioSharedExpense {
  key: string;
  /** The movement it is, when you fronted it. Absent means somebody else did. */
  transaction?: string;
  /** Who fronted it, when it was not you. */
  paidBy?: string;
  description?: string;
  date?: string;
  amount?: number;
  mode?: SplitMode;
  guests?: { count: number; name?: string };
  /** Absent inherits the group's default, as the API does. */
  shares?: ScenarioShare[];
  /**
   * What each share has to come to, by party key ("you", a contact key or
   * "guests"), written by hand. The generator refuses to write a fixture whose
   * resolver disagrees: a split nobody worked out on paper pins nothing.
   */
  expect?: Record<string, number>;
  note?: string;
}

export interface ScenarioSettlement {
  key: string;
  /** A contact key, or the key of the expense whose block of guests paid. */
  with: string;
  date: string;
  collected?: number;
  paid?: number;
  outsideApp?: boolean;
  /** Paid after the write-offs were decided, which is what makes their ceiling visible. */
  afterWriteOffs?: boolean;
  note?: string;
}

export interface ScenarioSharedGroup {
  key: string;
  name: string;
  /** Contact keys; you are always in it and are never listed. */
  contacts: string[];
  defaultMode?: "EQUAL" | "PERCENT";
  defaultShares?: ScenarioShare[];
  expenses: ScenarioSharedExpense[];
  /** Contact keys, or expense keys for a block of guests. */
  writeOffs?: string[];
  note?: string;
}

export interface ScenarioContact {
  key: string;
  name: string;
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
  /** A second dimension inside each bucket. Only with day, month or account. */
  splitBy?: SplitBy;
  /** Category keys; written out as ids. What a budget of several categories sends. */
  categories?: string[];
  /** Omitted on purpose in some queries: the server then means "all but ADJUSTMENT". */
  type?: TransactionType;
  from: string;
  to: string;
  note?: string;
}

/**
 * An ordered page of `GET /transactions`. Unlike a spending query, an omitted
 * `type` here means every type, ADJUSTMENT included: the listing has no
 * opinion about what counts as spending.
 */
export interface ScenarioListQuery {
  name: string;
  sort: SortField;
  order: SortOrder;
  type?: TransactionType;
  categories?: string[];
  from: string;
  to: string;
  limit: number;
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
  lists: ScenarioListQuery[];
  contacts?: ScenarioContact[];
  sharedGroups?: ScenarioSharedGroup[];
  settlements?: ScenarioSettlement[];
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
  type: CategoryType;
  archivedAt: string | null;
}

export interface FixtureTransaction {
  key: string;
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  // The local accounting day the API froze on the row, in the user's zone.
  dayKey: string;
  description: string | null;
  categoryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  tags: string[];
  currency: string;
  source: "MANUAL" | "QUICK";
  pendingDetails: boolean;
  /** What is left of it as yours once what came back is imputed; absent means the whole amount. */
  countsAsYours?: number;
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

export interface ExpectedSplit {
  key: string;
  total: number;
  count: number;
  avg: number;
}

export interface ExpectedBucket extends ExpectedSplit {
  /** Only when the query asked for a split. The splits add up to the bucket. */
  splits?: ExpectedSplit[];
}

export interface ExpectedSpending {
  name: string;
  query: {
    groupBy: GroupBy;
    splitBy: SplitBy | null;
    categoryIds: string[] | null;
    type: TransactionType | null;
    from: string;
    to: string;
    timezone: string;
  };
  total: number;
  buckets: ExpectedBucket[];
  note?: string;
}

export interface ExpectedList {
  name: string;
  query: {
    sort: SortField;
    order: SortOrder;
    categoryIds: string[] | null;
    type: TransactionType | null;
    from: string;
    to: string;
    timezone: string;
    limit: number;
  };
  /** The first page, IN ORDER. Ties are broken by id, in the direction of `order`. */
  transactionIds: string[];
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

export interface FixtureContact {
  key: string;
  id: string;
  name: string;
  archivedAt: string | null;
}

export interface FixtureShare {
  party: PartyKind;
  contactId: string | null;
  percent: number | null;
  fixedAmount: number | null;
  amount: number;
  /** What the imputation of the live payments left on it; never a typed figure. */
  collected: number;
}

export interface FixtureSharedExpense {
  key: string;
  id: string;
  groupId: string;
  /** The movement it is, when the user fronted it. */
  transactionId: string | null;
  description: string | null;
  date: string;
  amount: number;
  paidByContactId: string | null;
  customSplit: boolean;
  split: {
    mode: SplitMode;
    guests: { count: number; name: string | null } | null;
    shares: FixtureShare[];
  };
  deletedAt: string | null;
  note?: string;
}

export interface FixtureSettlement {
  key: string;
  id: string;
  counterparty: {
    kind: "CONTACT" | "GUESTS";
    contactId: string | null;
    expenseId: string | null;
  };
  date: string;
  collected: number;
  paid: number;
  outsideApp: boolean;
  /** Seeded after the write-offs: their ceiling was decided without this money. */
  afterWriteOffs: boolean;
  deletedAt: string | null;
  note?: string;
}

export interface FixtureSharedGroup {
  key: string;
  id: string;
  name: string;
  participantContactIds: string[];
  defaultSplit: {
    mode: "EQUAL" | "PERCENT";
    shares: { contactId: string | null; percent: number }[];
  };
  writeOffs: {
    contactId: string | null;
    expenseId: string | null;
    amount: number;
  }[];
  archivedAt: string | null;
  note?: string;
}

/** What one person, or one block of guests, is down for across the group. */
export interface ExpectedPerson {
  key: string;
  contactId: string | null;
  expenseId: string | null;
  owesYou: number;
  youOwe: number;
  /** Handed over beyond every line of theirs: it stays on the counter for the next one. */
  surplus: number;
  state: PersonState;
}

export interface ExpectedSharedGroup {
  key: string;
  id: string;
  amount: number;
  yourShare: number;
  owedToYou: number;
  youOwe: number;
  collected: number;
  writtenOff: number;
  status: "OPEN" | "SETTLED";
  people: ExpectedPerson[];
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
  contacts: FixtureContact[];
  sharedGroups: FixtureSharedGroup[];
  sharedExpenses: FixtureSharedExpense[];
  settlements: FixtureSettlement[];
  expected: {
    balances: { key: string; accountId: string; balance: number }[];
    pending: { count: number; total: number; transactionIds: string[] };
    spending: ExpectedSpending[];
    lists: ExpectedList[];
    budgets: { reference: string; views: ExpectedBudgetView[] };
    // What each movement is left counting as yours, and where every group stands.
    countsAsYours: { key: string; transactionId: string; amount: number }[];
    shared: ExpectedSharedGroup[];
  };
}
