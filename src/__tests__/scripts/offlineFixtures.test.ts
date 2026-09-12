/**
 * The committed parity contract (`fixtures/offline/`) must be exactly what the
 * generator produces from the scenarios: a rule that changes in
 * `scripts/offline-fixtures/` without a rebuild would leave the two repos
 * agreeing on stale figures. `npm run fixtures:check` is this same comparison
 * for the command line; here it runs inside `npm test`, with no database.
 */
import {
  buildFixtureFiles,
  driftAgainst,
  OUT_DIR,
} from "../../../scripts/offline-fixtures/build";
import {
  deriveList,
  deriveSpending,
} from "../../../scripts/offline-fixtures/derive";
import { FixtureTransaction } from "../../../scripts/offline-fixtures/types";

describe("offline parity fixtures", () => {
  const { fixtures, files } = buildFixtureFiles();

  it("commits exactly what the generator builds", () => {
    expect(driftAgainst(OUT_DIR, files)).toEqual([]);
  });

  it("covers the four scenarios the frontend vendors", () => {
    expect(fixtures.map((f) => f.id)).toEqual([
      "cop-bogota",
      "eur-madrid",
      "jpy-tokyo",
      "usd-new-york",
    ]);
  });

  // The one figure of the four scenarios a running float sum gets wrong.
  it("pins a balance that floats cannot add", () => {
    const madrid = fixtures.find((f) => f.id === "eur-madrid");
    const current = madrid?.expected.balances.find((b) => b.key === "current");
    expect(current?.balance).toBe(2378.68);
    expect(1000 - 10.1 + 1500 - 7.77 - 100 - 3.45).not.toBe(2378.68);
  });

  // No scenario may hold a tie, so the rule both sides agreed on has nowhere else to show.
  describe("the tiebreaks, which no scenario is allowed to carry", () => {
    const row = (
      n: number,
      over: Partial<FixtureTransaction> = {},
    ): FixtureTransaction => ({
      key: `row-${n}`,
      id: `0199${String(n).padStart(4, "0")}`,
      type: "EXPENSE",
      amount: 10,
      date: "2026-08-10T12:00:00-05:00",
      dayKey: "2026-08-10",
      description: null,
      categoryId: null,
      fromAccountId: "acc-1",
      toAccountId: null,
      tags: [],
      currency: "COP",
      source: "MANUAL",
      pendingDetails: false,
      deletedAt: null,
      ...over,
    });

    const window = {
      from: "2026-08-01T00:00:00-05:00",
      to: "2026-09-01T00:00:00-05:00",
      timezone: "America/Bogota",
      type: "EXPENSE" as const,
    };

    it("ranks two buckets of the same total by key, ascending", () => {
      const { buckets } = deriveSpending(
        [row(1, { categoryId: "cat-b" }), row(2, { categoryId: "cat-a" })],
        { ...window, groupBy: "category", splitBy: null, categoryIds: null },
      );

      expect(buckets.map((b) => b.key)).toEqual(["cat-a", "cat-b"]);
    });

    it("ranks two splits of the same total the same way", () => {
      const { buckets } = deriveSpending(
        [row(1, { categoryId: "cat-b" }), row(2, { categoryId: "cat-a" })],
        {
          ...window,
          groupBy: "month",
          splitBy: "category",
          categoryIds: null,
        },
      );

      expect(buckets[0].splits?.map((s) => s.key)).toEqual(["cat-a", "cat-b"]);
    });

    it("separates two rows of the same amount by id, in the page's direction", () => {
      const rows = [row(1, { amount: 50 }), row(2, { amount: 50 })];
      const list = (order: "asc" | "desc"): string[] =>
        deriveList(rows, {
          ...window,
          sort: "amount",
          order,
          categoryIds: null,
          limit: 10,
        });

      expect(list("asc")).toEqual([rows[0].id, rows[1].id]);
      expect(list("desc")).toEqual([rows[1].id, rows[0].id]);
    });
  });
});
