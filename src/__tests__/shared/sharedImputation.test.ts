import { impute, OwedLine } from "../../shared/sharedImputation";

const line = (key: string, day: string, owed: number): OwedLine => ({
  key,
  date: new Date(`2026-08-${day}T18:00:00.000Z`),
  owed,
});

const settled = (lines: OwedLine[], pool: number): Record<string, number> =>
  Object.fromEntries(impute(lines, pool).settled);

describe("impute", () => {
  it("covers the oldest line first", () => {
    const lines = [line("b", "20", 5000), line("a", "10", 3000)];

    expect(settled(lines, 4000)).toEqual({ a: 3000, b: 1000 });
  });

  it("leaves the rest of a line open when the money runs out", () => {
    expect(settled([line("a", "10", 3000)], 1200)).toEqual({ a: 1200 });
  });

  it("covers everything and keeps what is left over as a surplus", () => {
    const result = impute([line("a", "10", 3000)], 5000);

    expect(result.settled.get("a")).toBe(3000);
    expect(result.surplus).toBe(2000);
  });

  it("orders two lines of the same day by their id, so both devices agree", () => {
    const lines = [line("b", "10", 1000), line("a", "10", 1000)];

    expect(settled(lines, 1500)).toEqual({ a: 1000, b: 500 });
  });

  it("settles nothing with no money, and nothing with no lines", () => {
    expect(settled([line("a", "10", 3000)], 0)).toEqual({ a: 0 });
    expect(impute([], 5000)).toEqual({ settled: new Map(), surplus: 5000 });
  });

  it("treats a negative pool as none, and a negative line as nothing owed", () => {
    expect(settled([line("a", "10", 3000)], -100)).toEqual({ a: 0 });
    expect(settled([line("a", "10", -500)], 1000)).toEqual({ a: 0 });
  });
});
