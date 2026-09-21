/**
 * The committed parity contract (`fixtures/offline/`) must be exactly what the
 * generator produces from the scenarios: a rule that changes in
 * `scripts/offline-fixtures/` without a rebuild would leave the two repos
 * agreeing on stale figures. `npm run fixtures:check` is this same comparison
 * for the command line; here it runs inside `npm test`, with no database.
 */
import {
  buildFixture,
  buildFixtureFiles,
  driftAgainst,
  OUT_DIR,
} from "../../../scripts/offline-fixtures/build";
import {
  deriveList,
  deriveSpending,
  imputeMinor,
  splitInputProblem,
} from "../../../scripts/offline-fixtures/derive";
import {
  Scenario,
  ScenarioSharedGroup,
} from "../../../scripts/offline-fixtures/types";
import { FixtureTransaction } from "../../../scripts/offline-fixtures/types";

describe("offline parity fixtures", () => {
  const { fixtures, files } = buildFixtureFiles();

  it("commits exactly what the generator builds", () => {
    expect(driftAgainst(OUT_DIR, files)).toEqual([]);
  });

  it("covers the scenarios the frontend vendors", () => {
    expect(fixtures.map((f) => f.id)).toEqual([
      "cop-bogota",
      "eur-madrid",
      "jpy-tokyo",
      "usd-new-york",
      "cop-shared",
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

  // The generator would hand the difference to whoever paid and write a fixture the API refuses.
  describe("the figures a split is refused for", () => {
    let party = 0;
    // Each one is somebody else: a repeated party is a different refusal.
    const share = (
      over: Partial<{ percent: number; fixedAmount: number }> = {},
    ): {
      party: "CONTACT";
      contactId: string;
      units: number;
      percent?: number;
      fixedAmount?: number;
    } => ({
      party: "CONTACT",
      contactId: `contact-${++party}`,
      units: 1,
      ...over,
    });

    it.each([
      [
        "PERCENT" as const,
        [share({ percent: 60 }), share({ percent: 30 })],
        "add up to 100, not 90",
      ],
      [
        "PERCENT" as const,
        [share({ percent: 100 }), share()],
        "a percentage on every share",
      ],
      [
        "EXACT" as const,
        [share({ fixedAmount: 40 }), share({ fixedAmount: 40 })],
        "add up to the expense: 8000 of 10000",
      ],
      [
        "EXACT" as const,
        [share({ fixedAmount: 100 }), share()],
        "an amount on every share",
      ],
      [
        "FIXED_REST" as const,
        [share({ fixedAmount: 60 }), share({ fixedAmount: 40 })],
        "needs somebody to take the rest",
      ],
      [
        "FIXED_REST" as const,
        [share({ fixedAmount: 120 }), share()],
        "more than the expense",
      ],
      [
        "EQUAL" as const,
        [share({ fixedAmount: 50 }), share()],
        "takes no amounts",
      ],
      [
        "EXACT" as const,
        [share({ fixedAmount: 100, percent: 100 }), share()],
        "takes no percentages",
      ],
    ])("refuses a %s split that %s", (mode, rows, problem) => {
      expect(splitInputProblem(10_000, mode, rows, 100)).toContain(problem);
    });

    it("says nothing about the splits that do add up", () => {
      expect(
        splitInputProblem(
          10_000,
          "PERCENT",
          [share({ percent: 62.5 }), share({ percent: 37.5 })],
          100,
        ),
      ).toBeNull();
      expect(
        splitInputProblem(
          10_000,
          "FIXED_REST",
          [share({ fixedAmount: 60 }), share()],
          100,
        ),
      ).toBeNull();
    });
  });

  // Written by hand and compared: the guard that does the comparing needs one of its own.
  describe("a scenario the generator refuses to write", () => {
    const totals = {
      owedToYou: 15000,
      youOwe: 0,
      collected: 0,
      writtenOff: 0,
      status: "OPEN" as const,
      people: { ana: { owesYou: 15000, state: "NOT_PAID" as const } },
    };
    const group: ScenarioSharedGroup = {
      key: "outing",
      name: "Outing",
      contacts: ["ana"],
      expenses: [
        {
          key: "dinner",
          description: "Dinner",
          date: "2026-08-10T18:00:00-05:00",
          amount: 30000,
          expect: { you: 15000, ana: 15000 },
        },
      ],
      expect: totals,
    };
    const scenario = (over: ScenarioSharedGroup): Scenario => ({
      id: "test-only",
      title: "A scenario built in the test, never written out",
      pins: [],
      user: {
        id: "01930009-0000-7000-8000-00000000u009",
        timezone: "America/Bogota",
        currency: "COP",
        minorUnits: 0,
      },
      reference: "2026-08-20T12:00:00-05:00",
      accounts: [
        {
          key: "bank",
          name: "Bank",
          type: "ACCOUNT",
          openingBalance: 100000,
          isDefault: true,
        },
      ],
      categories: [],
      transactions: [],
      budgets: [],
      spending: [],
      lists: [],
      contacts: [{ key: "ana", name: "Ana" }],
      sharedGroups: [over],
      settlements: [],
    });

    it("builds the scenario it agrees with", () => {
      expect(() => buildFixture(scenario(group), 9)).not.toThrow();
    });

    it("refuses a share the scenario says comes to something else", () => {
      const wrong = {
        ...group,
        expenses: [
          { ...group.expenses[0], expect: { you: 20000, ana: 10000 } },
        ],
      };
      expect(() => buildFixture(scenario(wrong), 9)).toThrow(
        /you works out to 15000, not the 20000/,
      );
    });

    it("refuses a group whose figures the scenario says differently", () => {
      const wrong = {
        ...group,
        expect: { ...totals, owedToYou: 1 },
      };
      expect(() => buildFixture(scenario(wrong), 9)).toThrow(
        /owedToYou works out to 15000, not 1/,
      );
    });

    it("refuses a person the scenario puts in another state", () => {
      const wrong = {
        ...group,
        expect: {
          ...totals,
          people: { ana: { owesYou: 15000, state: "PAID" as const } },
        },
      };
      expect(() => buildFixture(scenario(wrong), 9)).toThrow(
        /ana state works out to NOT_PAID, not PAID/,
      );
    });

    it("refuses a share for somebody who is not in the group", () => {
      const wrong: ScenarioSharedGroup = {
        ...group,
        contacts: [],
        expenses: [
          {
            ...group.expenses[0],
            shares: [{ party: "you" }, { party: "ana" }],
            expect: undefined,
          },
        ],
        expect: undefined,
      };
      expect(() => buildFixture(scenario(wrong), 9)).toThrow(
        /ana is not in outing/,
      );
    });
  });

  describe("what a payment covers", () => {
    const line = (
      key: string,
      date: string,
      owed: number,
    ): { key: string; date: string; owed: number } => ({ key, date, owed });

    it("covers the oldest line first, whatever order the lines come in", () => {
      const { settled, surplus } = imputeMinor(
        [
          line("b", "2026-08-10T12:00:00-05:00", 1000),
          line("a", "2026-08-01T12:00:00-05:00", 1000),
        ],
        1500,
      );
      expect([settled.get("a"), settled.get("b"), surplus]).toEqual([
        1000, 500, 0,
      ]);
    });

    it("breaks a tie of the same instant by key, so two devices agree", () => {
      const same = "2026-08-06T12:00:00-05:00";
      const { settled } = imputeMinor(
        [line("s2", same, 1000), line("s1", same, 1000)],
        1200,
      );
      expect([settled.get("s1"), settled.get("s2")]).toEqual([1000, 200]);
    });

    it("leaves what covered no line as surplus, and never overshoots one", () => {
      const { settled, surplus } = imputeMinor(
        [line("a", "2026-08-01T12:00:00-05:00", 1000)],
        2500,
      );
      expect([settled.get("a"), surplus]).toEqual([1000, 1500]);
    });
  });
});
