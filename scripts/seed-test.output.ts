/**
 * Writes the ids the seed produced to `scripts/seed-test.output.json`
 * (gitignored) so the frontend's fixtures can import them instead of
 * duplicating the constants.
 */
import { writeFile } from "fs/promises";
import { join } from "path";

import { DateTime } from "luxon";

import {
  ACCOUNTS,
  BUDGET_IDS,
  EXTRA_CATEGORIES,
  QUICK_ADDS,
  REFERENCE_MONTH_EXPENSES,
  SEED_USER,
  UNCATEGORIZED_TOTAL,
} from "./seed-test.data";

const OUTPUT_PATH = join(__dirname, "seed-test.output.json");

const SEEDED_CATEGORY_KEYS = [
  "salary",
  "business",
  "other-income",
  "housing",
  "food",
  "transportation",
  "bills-services",
  "lifestyle",
  "transfer",
  "credit-card-payment",
] as const;

export async function writeSeedOutput(args: {
  referenceDay: DateTime;
  month: DateTime;
  lastDay: number;
  shifted: boolean;
  categoryId: (key: string) => string;
  accountId: (key: string) => string;
  transactionCount: number;
}): Promise<Record<string, unknown>> {
  const categoryTotals = Object.fromEntries(
    Object.entries(REFERENCE_MONTH_EXPENSES).map(([key, group]) => [
      key,
      group.total,
    ]),
  );
  const monthTotal =
    Object.values(REFERENCE_MONTH_EXPENSES).reduce((a, g) => a + g.total, 0) +
    UNCATEGORIZED_TOTAL;

  const output = {
    generatedAt: new Date().toISOString(),
    user: {
      id: SEED_USER.id,
      email: SEED_USER.email,
      password: SEED_USER.password,
      timezone: SEED_USER.timezone,
      currency: SEED_USER.currency,
      locale: SEED_USER.locale,
    },
    referenceDay: args.referenceDay.toISODate(),
    referenceMonth: args.month.toFormat("yyyy-MM"),
    // True when the reference day was too early in its month to hold the
    // dataset, so the seed used the previous, complete month instead.
    referenceMonthShifted: args.shifted,
    daysWithData: args.lastDay,
    accounts: Object.fromEntries(
      ACCOUNTS.map((a) => [
        a.key,
        {
          id: a.id,
          name: a.name,
          balance: a.finalBalance,
          archived: "archived" in a,
        },
      ]),
    ),
    categories: {
      ...Object.fromEntries(
        SEEDED_CATEGORY_KEYS.map((key) => [key, args.categoryId(key)]),
      ),
      ...Object.fromEntries(
        EXTRA_CATEGORIES.map((c) => [c.key, args.categoryId(c.key)]),
      ),
    },
    budgets: BUDGET_IDS,
    sessions: SEED_USER.devices.map((d) => ({
      familyId: d.familyId,
      userAgent: d.userAgent,
    })),
    totals: {
      transactions: args.transactionCount,
      monthSpending: monthTotal,
      byCategory: { ...categoryTotals, uncategorized: UNCATEGORIZED_TOTAL },
      quickAdds: QUICK_ADDS.length,
    },
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}
