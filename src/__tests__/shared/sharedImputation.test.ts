import {
  imputeCounterparty,
  oldestFirst,
  OwedLine,
  SettledPayment,
} from "../../shared/sharedImputation";

const CINE = "group-cine";
const COMER = "group-comer";

const line = (
  key: string,
  day: string,
  owed: number,
  groupId: string | null = null,
): OwedLine => ({
  key,
  date: new Date(`2026-08-${day}T18:00:00.000Z`),
  owed,
  groupId,
});

type Unrecorded = Omit<SettledPayment, "id" | "createdAt">;

const got = (amount: number, groupId: string | null = null): Unrecorded => ({
  collected: amount,
  paid: 0,
  groupId,
});

// Recorded in the order they are listed, a minute apart.
const recorded = (payments: Unrecorded[]): SettledPayment[] =>
  payments.map((one, n) => ({
    id: `p${String(n).padStart(3, "0")}`,
    createdAt: new Date(Date.UTC(2026, 8, 1, 12, n)),
    ...one,
  }));

const settled = (
  lines: OwedLine[],
  payments: Unrecorded[],
): Record<string, number> =>
  Object.fromEntries(imputeCounterparty(lines, [], recorded(payments)).theirs);

// The imputation before T-240: every payment in one pool, oldest line first.
function pooled(
  lines: OwedLine[],
  pool: number,
): { settled: Map<string, number>; surplus: number } {
  let left = Math.max(0, pool);
  const result = new Map<string, number>();
  const ordered = [...lines].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  for (const one of ordered) {
    const covered = Math.min(Math.max(0, one.owed), left);
    result.set(one.key, covered);
    left -= covered;
  }
  return { settled: result, surplus: left };
}

// And what the ledger did with it: your lines first, and what was left of it off what they gave.
function pooledCounterparty(
  theirLines: OwedLine[],
  yourLines: OwedLine[],
  payments: SettledPayment[],
): ReturnType<typeof imputeCounterparty> {
  const theyOwe = payments.reduce((sum, one) => sum + one.collected, 0);
  const youOwe = payments.reduce((sum, one) => sum + one.paid, 0);
  const yours = pooled(yourLines, youOwe);
  const theirs = pooled(theirLines, theyOwe - yours.surplus);
  return {
    theirs: theirs.settled,
    yours: yours.settled,
    surplus: {
      theirs: theirs.surplus,
      yours: Math.max(0, yours.surplus - theyOwe),
    },
  };
}

describe("imputeCounterparty", () => {
  it("covers the oldest line first", () => {
    const lines = [line("b", "20", 5000), line("a", "10", 3000)];

    expect(settled(lines, [got(4000)])).toEqual({ a: 3000, b: 1000 });
  });

  it("leaves the rest of a line open when the money runs out", () => {
    expect(settled([line("a", "10", 3000)], [got(1200)])).toEqual({ a: 1200 });
  });

  it("covers everything and keeps what is left over as their surplus", () => {
    const result = imputeCounterparty(
      [line("a", "10", 3000)],
      [],
      recorded([got(2000), got(3000)]),
    );

    expect(result.theirs.get("a")).toBe(3000);
    expect(result.surplus).toEqual({ theirs: 2000, yours: 0 });
  });

  it("orders two lines of the same day by their id, so both devices agree", () => {
    const lines = [line("b", "10", 1000), line("a", "10", 1000)];

    expect(settled(lines, [got(1500)])).toEqual({ a: 1000, b: 500 });
  });

  it("settles nothing with no money, and nothing with no lines", () => {
    expect(settled([line("a", "10", 3000)], [])).toEqual({ a: 0 });
    expect(settled([line("a", "10", 3000)], [got(0)])).toEqual({ a: 0 });
    expect(imputeCounterparty([], [], recorded([got(5000)]))).toEqual({
      theirs: new Map(),
      yours: new Map(),
      surplus: { theirs: 5000, yours: 0 },
    });
  });

  it("treats a negative line as nothing owed", () => {
    expect(settled([line("a", "10", -500)], [got(1000)])).toEqual({ a: 0 });
  });

  describe("a payment from a group [T-240]", () => {
    // She owes 50 in Cine, the older line, and 20 in Comer.
    const lines = [
      line("cine", "10", 5000, CINE),
      line("comer", "20", 2000, COMER),
    ];

    it("covers that group's line before an older one elsewhere", () => {
      expect(settled(lines, [got(2000, COMER)])).toEqual({
        cine: 0,
        comer: 2000,
      });
    });

    it("leaves the older group untouched while that group is still open", () => {
      expect(settled(lines, [got(1000, COMER)])).toEqual({
        cine: 0,
        comer: 1000,
      });
    });

    it("sends what is left once the group is paid to the oldest line elsewhere", () => {
      expect(settled(lines, [got(3500, COMER)])).toEqual({
        cine: 1500,
        comer: 2000,
      });
    });

    it("pays from no group oldest first, as it always did", () => {
      expect(settled(lines, [got(2000)])).toEqual({ cine: 2000, comer: 0 });
    });

    it("covers the group's own lines oldest first among themselves", () => {
      const three = [
        line("old", "05", 1000),
        line("late", "25", 1000, COMER),
        line("early", "15", 1000, COMER),
      ];

      expect(settled(three, [got(1500, COMER)])).toEqual({
        old: 0,
        early: 1000,
        late: 500,
      });
    });

    it("finds nothing to put first in a group with no line of theirs", () => {
      expect(settled(lines, [got(2000, "group-gone")])).toEqual({
        cine: 2000,
        comer: 0,
      });
    });

    it("covers your lines of that group first when you pay them back", () => {
      const result = imputeCounterparty(
        [],
        lines,
        recorded([{ collected: 0, paid: 2500, groupId: COMER }]),
      );

      expect(Object.fromEntries(result.yours)).toEqual({
        cine: 500,
        comer: 2000,
      });
    });

    it("never moves what an earlier payment covered", () => {
      // A payment from People took Cine first; the one from Comer finds Cine half paid.
      expect(settled(lines, [got(2500), got(4000, COMER)])).toEqual({
        cine: 4500,
        comer: 2000,
      });
      // The other way round, Comer was already covered by its own payment.
      expect(settled(lines, [got(2000, COMER), got(2500)])).toEqual({
        cine: 2500,
        comer: 2000,
      });
    });

    it("keeps the priority when a line is edited and everything is imputed again", () => {
      const edited = [
        line("cine", "10", 5000, CINE),
        line("comer", "20", 1500, COMER),
      ];

      // Comer went from 20 down to 15: the same payment of 20 covers it and 5 reaches Cine.
      expect(settled(edited, [got(2000, COMER)])).toEqual({
        cine: 500,
        comer: 1500,
      });
    });

    it("keeps the priority when a line of that group is dated before the other group", () => {
      const redated = [
        line("cine", "10", 5000, CINE),
        line("comer", "01", 2000, COMER),
        line("comer-2", "21", 1000, COMER),
      ];

      expect(settled(redated, [got(2500, COMER)])).toEqual({
        cine: 0,
        comer: 2000,
        "comer-2": 500,
      });
    });

    it("takes a refund off the newest money they gave, so an older payment keeps what it covers", () => {
      const result = imputeCounterparty(
        lines,
        [],
        recorded([
          got(2000, COMER),
          got(3000),
          { collected: 0, paid: 1000, groupId: null },
        ]),
      );

      // 1.000 goes back to her: it comes off People's 3.000, not off what Comer's covered.
      expect(Object.fromEntries(result.theirs)).toEqual({
        cine: 2000,
        comer: 2000,
      });
      expect(result.surplus).toEqual({ theirs: 0, yours: 0 });
    });

    it("says what you handed back beyond everything they ever gave", () => {
      const result = imputeCounterparty(
        lines,
        [],
        recorded([
          got(1000, COMER),
          { collected: 0, paid: 4000, groupId: null },
        ]),
      );

      expect(result.theirs.get("comer")).toBe(0);
      expect(result.surplus).toEqual({ theirs: 0, yours: 3000 });
    });
  });

  describe("in the order the payments were recorded", () => {
    // Comer's older line, then Cine, then Comer's newer one.
    const lines = [
      line("comer-old", "03", 1000, COMER),
      line("cine", "04", 1000, CINE),
      line("comer-new", "05", 4000, COMER),
    ];
    const people = { collected: 1000, paid: 0, groupId: null };
    const comer = { collected: 4000, paid: 0, groupId: COMER };

    it("sorts by createdAt, not by the order they come in", () => {
      const payments: SettledPayment[] = [
        { id: "b", createdAt: new Date("2026-09-02T00:00:00Z"), ...comer },
        { id: "a", createdAt: new Date("2026-09-01T00:00:00Z"), ...people },
      ];

      // People's went first and took Comer's older line; Comer's then covered its newer one.
      expect(
        Object.fromEntries(imputeCounterparty(lines, [], payments).theirs),
      ).toEqual({ "comer-old": 1000, cine: 0, "comer-new": 4000 });
    });

    it("breaks a tie by id, and puts one not stored yet last", () => {
      const same = new Date("2026-09-01T00:00:00Z");
      const tie: SettledPayment[] = [
        { id: "b", createdAt: same, ...people },
        { id: "a", createdAt: same, ...comer },
      ];
      const unstored: SettledPayment[] = [
        { id: "a", ...people },
        { id: "z", createdAt: same, ...comer },
      ];

      // Comer's first either way: Comer's lines paid, and People's 1.000 reach Cine.
      const comerFirst = { "comer-old": 1000, cine: 1000, "comer-new": 3000 };
      expect(
        Object.fromEntries(imputeCounterparty(lines, [], tie).theirs),
      ).toEqual(comerFirst);
      expect(
        Object.fromEntries(imputeCounterparty(lines, [], unstored).theirs),
      ).toEqual(comerFirst);
    });
  });

  describe("with no payment from a group it is the pooled imputation, figure for figure", () => {
    // A small deterministic generator, so a failure prints the same case every run.
    const random = (seed: number): (() => number) => {
      let state = seed;
      return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
      };
    };

    const cases = Array.from({ length: 300 }, (_, n) => {
      const next = random(n + 1);
      const int = (max: number): number => Math.floor(next() * max);
      const lines = Array.from({ length: int(8) }, (_, i) =>
        line(
          `e${int(4)}${i}`,
          String(1 + int(5)).padStart(2, "0"),
          int(8) === 0 ? -int(1000) : int(10_000),
          int(2) === 0 ? CINE : COMER,
        ),
      );
      const payments: SettledPayment[] = Array.from(
        { length: int(6) },
        (_, i) => ({
          id: `p${int(9)}${i}`,
          ...(int(5) === 0
            ? {}
            : { createdAt: new Date(Date.UTC(2026, 8, 1 + int(3))) }),
          collected: int(3) === 0 ? 0 : int(12_000),
          paid: int(3) === 0 ? int(8_000) : 0,
          groupId: null,
        }),
      );
      return {
        n,
        theirLines: lines.filter((_, i) => i % 2 === 0),
        yourLines: lines.filter((_, i) => i % 2 === 1),
        payments,
      };
    });

    it("covers the same lines both ways, with the same refund and surpluses, in 300 cases", () => {
      for (const { n, theirLines, yourLines, payments } of cases) {
        expect([
          n,
          imputeCounterparty(theirLines, yourLines, payments),
        ]).toEqual([n, pooledCounterparty(theirLines, yourLines, payments)]);
      }
    });
  });
});

describe("oldestFirst", () => {
  it("orders by date, and by key on the same instant", () => {
    const at = new Date("2026-08-10T18:00:00.000Z");
    const rows = [
      { key: "b", date: at },
      { key: "z", date: new Date("2026-08-01T18:00:00.000Z") },
      { key: "a", date: at },
    ];

    expect([...rows].sort(oldestFirst).map((row) => row.key)).toEqual([
      "z",
      "a",
      "b",
    ]);
  });
});
