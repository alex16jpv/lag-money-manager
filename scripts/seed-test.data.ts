/**
 * The dataset behind `npm run seed:test`, kept apart from the logic that
 * applies it. Every id is a fixed UUID v7 so the frontend's fixtures and
 * screenshot diffs can hard-code them.
 *
 * Amounts are whole pesos (COP). The per-category totals are load-bearing:
 * the design's screens display them, so the seed asserts them after writing.
 */
import { DateTime } from "luxon";

export const SEED_USER = {
  id: "01920000-0000-7000-8000-000000000001",
  name: "Andrés Valencia",
  email: "seed@ledgerflow.test",
  password: "LedgerFlow!2026",
  timezone: "America/Bogota",
  currency: "COP",
  locale: "en",
  devices: [
    {
      jti: "01920000-0000-7000-8000-0000000000d1",
      familyId: "01920000-0000-7000-8000-0000000000f1",
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile",
    },
    {
      jti: "01920000-0000-7000-8000-0000000000d2",
      familyId: "01920000-0000-7000-8000-0000000000f2",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/128.0",
    },
  ],
} as const;

interface SeedAccount {
  key: string;
  id: string;
  name: string;
  type: string;
  color: string;
  finalBalance: number;
  archived?: boolean;
}

/** Final balances the designs show; opening balances are derived from them. */
export const ACCOUNTS: readonly SeedAccount[] = [
  {
    key: "bancolombia",
    id: "01920000-0000-7000-8000-00000000a001",
    name: "Bancolombia",
    type: "ACCOUNT",
    color: "BLUE",
    finalBalance: 3_420_500,
  },
  {
    key: "cash",
    id: "01920000-0000-7000-8000-00000000a002",
    name: "Cash",
    type: "CASH",
    color: "GRAY",
    finalBalance: 184_000,
  },
  {
    key: "visa",
    id: "01920000-0000-7000-8000-00000000a003",
    name: "Visa Gold",
    type: "CARD",
    color: "PURPLE",
    finalBalance: -1_245_900,
  },
  {
    key: "savings",
    id: "01920000-0000-7000-8000-00000000a004",
    name: "Savings",
    type: "SAVINGS",
    color: "GREEN",
    finalBalance: 8_900_000,
  },
  {
    key: "nequi",
    id: "01920000-0000-7000-8000-00000000a005",
    name: "Nequi",
    type: "OTHER",
    color: "PINK",
    finalBalance: 0,
    archived: true,
  },
];

/**
 * Fixed ids for the ten categories registration seeds. Registration mints its
 * own UUIDs, so the seed recreates them with these: the frontend's fixtures
 * reference categories by id, and an id that changes every run is not a
 * fixture.
 */
export const SEEDED_CATEGORY_IDS: Record<string, string> = {
  salary: "01920000-0000-7000-8000-00000000c101",
  business: "01920000-0000-7000-8000-00000000c102",
  "other-income": "01920000-0000-7000-8000-00000000c103",
  housing: "01920000-0000-7000-8000-00000000c104",
  food: "01920000-0000-7000-8000-00000000c105",
  transportation: "01920000-0000-7000-8000-00000000c106",
  "bills-services": "01920000-0000-7000-8000-00000000c107",
  lifestyle: "01920000-0000-7000-8000-00000000c108",
  transfer: "01920000-0000-7000-8000-00000000c109",
  "credit-card-payment": "01920000-0000-7000-8000-00000000c10a",
};

/** Beyond the ten seeded at registration. `vacation` is archived by the seed. */
export const EXTRA_CATEGORIES = [
  {
    key: "coffee",
    id: "01920000-0000-7000-8000-00000000c001",
    name: "Coffee",
    icon: "coffee",
    color: "BROWN",
    type: "EXPENSE",
  },
  {
    key: "health",
    id: "01920000-0000-7000-8000-00000000c002",
    name: "Health",
    icon: "stethoscope",
    color: "RED",
    type: "EXPENSE",
  },
  {
    key: "pets",
    id: "01920000-0000-7000-8000-00000000c003",
    name: "Pets",
    icon: "dog",
    color: "YELLOW",
    type: "EXPENSE",
  },
  {
    key: "vacation",
    id: "01920000-0000-7000-8000-00000000c004",
    name: "Vacation",
    icon: "plane",
    color: "CYAN",
    type: "EXPENSE",
  },
] as const;

export const ARCHIVED_CATEGORY_KEY = "vacation";

/**
 * Expenses of the reference month, grouped by the category whose total the
 * designs display. Each group's amounts sum to that exact total — change one
 * and the seed's own verification fails.
 */
export const REFERENCE_MONTH_EXPENSES = {
  food: {
    total: 412_000,
    items: [
      {
        amount: 78_900,
        description: "Carulla groceries",
        account: "bancolombia",
        tags: ["groceries"],
      },
      {
        amount: 92_400,
        description: "Éxito monthly stock-up",
        account: "bancolombia",
        tags: ["groceries", "monthly"],
      },
      {
        amount: 45_600,
        description: "Frubana produce",
        account: "cash",
        tags: ["groceries"],
      },
      {
        amount: 38_200,
        description: "Lunch with the team",
        account: "visa",
        tags: ["work"],
      },
      { amount: 22_300, description: "Empanadas", account: "cash", tags: [] },
      { amount: 18_700, description: "Bakery", account: "cash", tags: [] },
      {
        amount: 31_200,
        description: "Sunday market",
        account: "cash",
        tags: ["groceries"],
      },
      {
        amount: 26_400,
        description: "Rappi dinner",
        account: "visa",
        tags: [],
      },
      { amount: 15_800, description: "Arepas", account: "cash", tags: [] },
      { amount: 14_200, description: "Fruit stand", account: "cash", tags: [] },
      {
        amount: 16_400,
        description: "Corner store",
        account: "cash",
        tags: [],
      },
      { amount: 6_000, description: "Juice", account: "cash", tags: [] },
      { amount: 5_900, description: "Snack", account: "cash", tags: [] },
    ],
  },
  lifestyle: {
    total: 356_000,
    items: [
      { amount: 189_000, description: "Zara", account: "visa", tags: [] },
      {
        amount: 42_000,
        description: "Cine Colombia",
        account: "visa",
        tags: [],
      },
      {
        amount: 16_900,
        description: "Spotify",
        account: "visa",
        tags: ["monthly"],
      },
      {
        amount: 35_000,
        description: "Bookshop",
        account: "bancolombia",
        tags: [],
      },
      {
        amount: 48_600,
        description: "Barber and pharmacy",
        account: "cash",
        tags: [],
      },
      {
        amount: 14_200,
        description: "Netflix",
        account: "visa",
        tags: ["monthly"],
      },
      { amount: 10_300, description: "Newsstand", account: "cash", tags: [] },
    ],
  },
  transportation: {
    total: 185_500,
    items: [
      {
        amount: 18_400,
        description: "Uber to work",
        account: "bancolombia",
        tags: ["work"],
      },
      {
        amount: 18_400,
        description: "Uber home",
        account: "bancolombia",
        tags: ["work"],
      },
      {
        amount: 22_000,
        description: "Airport taxi",
        account: "visa",
        tags: ["travel"],
      },
      {
        amount: 15_600,
        description: "TransMilenio top-up",
        account: "cash",
        tags: ["work"],
      },
      { amount: 12_300, description: "Parking", account: "cash", tags: [] },
      { amount: 45_000, description: "Terpel fuel", account: "visa", tags: [] },
      {
        amount: 28_900,
        description: "Car wash and toll",
        account: "bancolombia",
        tags: [],
      },
      { amount: 12_400, description: "Bike repair", account: "cash", tags: [] },
      { amount: 6_250, description: "Bus fare", account: "cash", tags: [] },
      { amount: 6_250, description: "Bus fare", account: "cash", tags: [] },
    ],
  },
  "bills-services": {
    total: 186_200,
    items: [
      {
        amount: 186_200,
        description: "EPM electricity",
        account: "bancolombia",
        tags: ["monthly"],
      },
    ],
  },
  coffee: {
    total: 98_400,
    items: [
      {
        amount: 9_800,
        description: "Pergamino Coffee",
        account: "cash",
        tags: ["coffee"],
      },
      {
        amount: 9_800,
        description: "Pergamino Coffee",
        account: "cash",
        tags: ["coffee"],
      },
      {
        amount: 8_900,
        description: "Café Quindío",
        account: "cash",
        tags: ["coffee"],
      },
      {
        amount: 11_300,
        description: "Juan Valdez",
        account: "visa",
        tags: ["coffee", "latte"],
      },
      {
        amount: 12_600,
        description: "Azahar Coffee",
        account: "visa",
        tags: ["coffee", "latte"],
      },
      {
        amount: 7_400,
        description: "Office espresso",
        account: "cash",
        tags: ["coffee", "work"],
      },
      {
        amount: 9_200,
        description: "Juan Valdez",
        account: "cash",
        tags: ["coffee"],
      },
      {
        amount: 10_600,
        description: "Devoción",
        account: "visa",
        tags: ["coffee", "latte"],
      },
      {
        amount: 9_400,
        description: "Corner café",
        account: "cash",
        tags: ["coffee"],
      },
      {
        amount: 4_700,
        description: "Tinto",
        account: "cash",
        tags: ["coffee"],
      },
      {
        amount: 4_700,
        description: "Tinto",
        account: "cash",
        tags: ["coffee"],
      },
    ],
  },
} as const;

/** Quick-adds: amount only, no category — the review inbox of the designs. */
export const QUICK_ADDS = [12_500, 15_400, 20_000] as const;

export const UNCATEGORIZED_TOTAL = QUICK_ADDS.reduce((a, b) => a + b, 0);

export const NON_EXPENSE = {
  salary: {
    amount: 4_200_000,
    description: "August salary",
    account: "bancolombia",
  },
  transfer: { amount: 1_000_000, from: "bancolombia", to: "savings" },
  adjustment: { amount: 7_500, account: "cash" },
} as const;

/** Older months, so stats and `?reference=` have something to walk back to. */
export const PRIOR_MONTHS = [
  {
    monthsAgo: 1,
    expenses: [
      96_400, 148_200, 32_500, 61_900, 18_700, 24_300, 187_400, 45_000,
    ],
    income: 4_200_000,
  },
  {
    monthsAgo: 2,
    expenses: [88_100, 132_600, 41_800, 57_200, 22_900],
    income: 4_200_000,
  },
] as const;

export const BUDGET_IDS = {
  global: "01920000-0000-7000-8000-00000000b001",
  food: "01920000-0000-7000-8000-00000000b002",
  transportation: "01920000-0000-7000-8000-00000000b003",
  lifestyle: "01920000-0000-7000-8000-00000000b004",
  coffee: "01920000-0000-7000-8000-00000000b005",
  bills: "01920000-0000-7000-8000-00000000b006",
  vacation: "01920000-0000-7000-8000-00000000b007",
  expiredPrevMonth: "01920000-0000-7000-8000-00000000b008",
  expiredDecember: "01920000-0000-7000-8000-00000000b009",
  archived: "01920000-0000-7000-8000-00000000b00a",
} as const;

/**
 * The reference day anchors every date. It defaults to today so a fresh run is
 * always valid: the API rejects dates more than 24 h ahead, so a future
 * SEED_TODAY would make every write fail.
 */
export function resolveReferenceDay(raw: string | undefined): DateTime {
  const today = DateTime.now().setZone(SEED_USER.timezone).startOf("day");
  if (!raw) return today;

  const parsed = DateTime.fromISO(raw, { zone: SEED_USER.timezone }).startOf(
    "day",
  );
  if (!parsed.isValid) {
    throw new Error(`SEED_TODAY is not a valid ISO date: ${raw}`);
  }
  if (parsed > today) {
    throw new Error(
      `SEED_TODAY=${raw} is in the future. Transactions dated more than 24 h ahead are rejected (FUTURE_DATE), so the seed would fail halfway.`,
    );
  }
  return parsed;
}

/**
 * The month the dataset describes. The designs show a month in progress, but a
 * reference day early in the month leaves no room for the expenses, so the seed
 * falls back to the last complete month and reports which one it used.
 */
export function resolveReferenceMonth(referenceDay: DateTime): {
  month: DateTime;
  lastDay: number;
  shifted: boolean;
} {
  const MIN_DAYS = 22;
  if (referenceDay.day >= MIN_DAYS) {
    return {
      month: referenceDay.startOf("month"),
      lastDay: referenceDay.day,
      shifted: false,
    };
  }
  const previous = referenceDay.startOf("month").minus({ months: 1 });
  return {
    month: previous,
    lastDay: previous.daysInMonth as number,
    shifted: true,
  };
}
