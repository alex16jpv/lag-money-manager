import { DomainValidationError } from "../../domain/errors";
import { resolveShares, SplitRow } from "../../shared/splitShares";

const person = (input: number | null = null): SplitRow => ({ units: 1, input });
const guests = (count: number, input: number | null = null): SplitRow => ({
  units: count,
  input,
});

const sum = (values: number[]): number =>
  Number(values.reduce((total, value) => total + value, 0).toFixed(2));

describe("resolveShares", () => {
  describe("equal", () => {
    it("divides evenly when it divides", () => {
      const shares = resolveShares({
        total: 90000,
        currency: "COP",
        mode: "EQUAL",
        rows: [person(), person(), person()],
        payerIndex: 0,
      });

      expect(shares).toEqual([30000, 30000, 30000]);
    });

    it("gives the odd peso to whoever paid, and only to them", () => {
      const shares = resolveShares({
        total: 100000,
        currency: "COP",
        mode: "EQUAL",
        rows: [person(), person(), person()],
        payerIndex: 1,
      });

      expect(shares).toEqual([33333, 33334, 33333]);
      expect(sum(shares)).toBe(100000);
    });

    it("never splits a peso, because the peso has no cents", () => {
      const shares = resolveShares({
        total: 10,
        currency: "COP",
        mode: "EQUAL",
        rows: [person(), person(), person()],
        payerIndex: 0,
      });

      expect(shares).toEqual([4, 3, 3]);
      expect(shares.every(Number.isInteger)).toBe(true);
    });

    it("splits to the cent in a currency that has them", () => {
      const shares = resolveShares({
        total: 100,
        currency: "USD",
        mode: "EQUAL",
        rows: [person(), person(), person()],
        payerIndex: 0,
      });

      expect(shares).toEqual([33.34, 33.33, 33.33]);
      expect(sum(shares)).toBe(100);
    });

    it("counts a block of guests as as many parts as there are of them", () => {
      const shares = resolveShares({
        total: 230000,
        currency: "COP",
        mode: "EQUAL",
        rows: [person(), person(), person(), guests(20)],
        payerIndex: 0,
      });

      expect(shares).toEqual([10000, 10000, 10000, 200000]);
    });

    it("gives the block its real weight instead of one floored part per head", () => {
      const shares = resolveShares({
        total: 100000,
        currency: "COP",
        mode: "EQUAL",
        rows: [person(), person(), person(), guests(20)],
        payerIndex: 0,
      });

      // 20/23 of 100000 is 86956.52, not 20 times a floored 4347.
      expect(shares).toEqual([4350, 4347, 4347, 86956]);
      expect(sum(shares)).toBe(100000);
    });

    it("keeps the payer's extra to the odd unit, not to one per head", () => {
      const shares = resolveShares({
        total: 100000,
        currency: "COP",
        mode: "EQUAL",
        rows: [person(), person(), person(), guests(20)],
        payerIndex: 0,
      });
      const fair = 100000 / 23;

      expect((shares[0] as number) - fair).toBeLessThan(4);
    });

    it("leaves the remainder with the payer rather than with the block", () => {
      const shares = resolveShares({
        total: 101,
        currency: "COP",
        mode: "EQUAL",
        rows: [person(), guests(3)],
        payerIndex: 0,
      });

      expect(shares).toEqual([26, 75]);
      expect(sum(shares)).toBe(101);
    });

    it("gives everything to the payer when there is less than one part to go round", () => {
      const shares = resolveShares({
        total: 2,
        currency: "COP",
        mode: "EQUAL",
        rows: [person(), person(), person()],
        payerIndex: 2,
      });

      expect(shares).toEqual([0, 0, 2]);
    });
  });

  describe("big amounts", () => {
    // The plain product would pass 2^53 here and drift by one from 64-bit integers.
    it("keeps a percentage exact at the top of what an amount can be", () => {
      const shares = resolveShares({
        total: 6132938589771,
        currency: "COP",
        mode: "PERCENT",
        rows: [person(98.69), person(1.31)],
        payerIndex: 1,
      });

      expect(shares[0]).toBe(6052597094244);
      expect(sum(shares)).toBe(6132938589771);
    });
  });

  describe("percent", () => {
    it("takes each share of the total", () => {
      const shares = resolveShares({
        total: 200000,
        currency: "COP",
        mode: "PERCENT",
        rows: [person(50), person(30), person(20)],
        payerIndex: 0,
      });

      expect(shares).toEqual([100000, 60000, 40000]);
    });

    it("takes two decimals of a percentage", () => {
      const shares = resolveShares({
        total: 100000,
        currency: "COP",
        mode: "PERCENT",
        rows: [person(33.33), person(33.33), person(33.34)],
        payerIndex: 0,
      });

      expect(sum(shares)).toBe(100000);
      expect(shares[1]).toBe(33330);
    });

    it("refuses percentages that do not add up to 100", () => {
      expect(() =>
        resolveShares({
          total: 100,
          currency: "COP",
          mode: "PERCENT",
          rows: [person(50), person(30)],
          payerIndex: 0,
        }),
      ).toThrow(DomainValidationError);
    });
  });

  describe("exact", () => {
    it("takes the amounts as they are", () => {
      const shares = resolveShares({
        total: 90000,
        currency: "COP",
        mode: "EXACT",
        rows: [person(50000), person(40000)],
        payerIndex: 0,
      });

      expect(shares).toEqual([50000, 40000]);
    });

    it("refuses amounts that do not add up to the expense", () => {
      expect(() =>
        resolveShares({
          total: 90000,
          currency: "COP",
          mode: "EXACT",
          rows: [person(50000), person(30000)],
          payerIndex: 0,
        }),
      ).toThrow("add up to the expense");
    });

    it("refuses a negative share", () => {
      expect(() =>
        resolveShares({
          total: 90000,
          currency: "COP",
          mode: "EXACT",
          rows: [person(100000), person(-10000)],
          payerIndex: 0,
        }),
      ).toThrow("cannot be negative");
    });
  });

  describe("fixed plus rest", () => {
    it("pins what it is told and splits the rest between the others", () => {
      const shares = resolveShares({
        total: 150000,
        currency: "COP",
        mode: "FIXED_REST",
        rows: [person(), person(50000), person()],
        payerIndex: 0,
      });

      expect(shares).toEqual([50000, 50000, 50000]);
    });

    it("weighs a block of guests in the rest", () => {
      const shares = resolveShares({
        total: 120000,
        currency: "COP",
        mode: "FIXED_REST",
        rows: [person(), person(20000), guests(3)],
        payerIndex: 0,
      });

      expect(shares).toEqual([25000, 20000, 75000]);
    });

    it("refuses fixed shares that are worth more than the expense", () => {
      expect(() =>
        resolveShares({
          total: 100,
          currency: "COP",
          mode: "FIXED_REST",
          rows: [person(), person(200)],
          payerIndex: 0,
        }),
      ).toThrow("more than the expense");
    });

    // The doc says so out loud: a pinned payer absorbs the remainder like any other payer.
    it("moves a pinned payer's own figure by the odd unit", () => {
      const shares = resolveShares({
        total: 101,
        currency: "COP",
        mode: "FIXED_REST",
        rows: [person(40), person(), person(), person()],
        payerIndex: 0,
      });

      expect(shares).toEqual([41, 20, 20, 20]);
      expect(sum(shares)).toBe(101);
    });

    it("refuses a split where nobody takes the rest", () => {
      expect(() =>
        resolveShares({
          total: 100,
          currency: "COP",
          mode: "FIXED_REST",
          rows: [person(50), person(50)],
          payerIndex: 0,
        }),
      ).toThrow("use exact amounts instead");
    });
  });

  describe("what it refuses", () => {
    it("refuses a split with no shares", () => {
      expect(() =>
        resolveShares({
          total: 100,
          currency: "COP",
          mode: "EQUAL",
          rows: [],
          payerIndex: 0,
        }),
      ).toThrow("at least one share");
    });

    it("refuses a payer who has no share", () => {
      expect(() =>
        resolveShares({
          total: 100,
          currency: "COP",
          mode: "EQUAL",
          rows: [person()],
          payerIndex: 3,
        }),
      ).toThrow("The payer must be one of the shares");
    });

    it("refuses an expense of nothing", () => {
      expect(() =>
        resolveShares({
          total: 0,
          currency: "COP",
          mode: "EQUAL",
          rows: [person()],
          payerIndex: 0,
        }),
      ).toThrow("greater than zero");
    });

    it("refuses figures in an equal split", () => {
      expect(() =>
        resolveShares({
          total: 100,
          currency: "COP",
          mode: "EQUAL",
          rows: [person(60), person(40)],
          payerIndex: 0,
        }),
      ).toThrow("takes no figures");
    });

    it("carries the code the client branches on", () => {
      expect(() =>
        resolveShares({
          total: 100,
          currency: "COP",
          mode: "PERCENT",
          rows: [person(10), person(10)],
          payerIndex: 0,
        }),
      ).toThrow(
        expect.objectContaining({ code: "SPLIT_INVALID", field: "split" }),
      );
    });
  });

  // The offline projection may walk the rows in another order; the figures still have to match.
  it("gives the same shares whatever order the rows come in", () => {
    const rows = [person(), person(), guests(4)];
    const forward = resolveShares({
      total: 100000,
      currency: "COP",
      mode: "EQUAL",
      rows,
      payerIndex: 1,
    });
    const reversed = resolveShares({
      total: 100000,
      currency: "COP",
      mode: "EQUAL",
      rows: [rows[2] as SplitRow, rows[1] as SplitRow, rows[0] as SplitRow],
      payerIndex: 1,
    });

    expect(reversed).toEqual([forward[2], forward[1], forward[0]]);
  });
});
