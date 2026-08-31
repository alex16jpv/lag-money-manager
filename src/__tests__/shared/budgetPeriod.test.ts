import { resolvePeriod } from "../../shared/budgetPeriod";

const TZ = "America/Bogota"; // fixed -5, no DST

describe("resolvePeriod", () => {
  it("resolves the monthly window and key in the user's timezone", () => {
    const ref = new Date("2026-08-15T12:00:00Z");
    const { from, to, key } = resolvePeriod({ type: "MONTHLY" }, ref, TZ);

    expect(key).toBe("2026-08");
    // Bogota midnight Aug 1 = 05:00Z
    expect(from.toISOString()).toBe("2026-08-01T05:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-01T05:00:00.000Z");
    expect(from.getTime()).toBeLessThan(ref.getTime());
    expect(to.getTime()).toBeGreaterThan(ref.getTime());
  });

  it("puts a UTC instant in the correct local month (timezone matters)", () => {
    // 03:00Z is still Jul 31 22:00 in Bogota
    const ref = new Date("2026-08-01T03:00:00Z");
    const { key } = resolvePeriod({ type: "MONTHLY" }, ref, TZ);
    expect(key).toBe("2026-07");
  });

  it("resolves quarterly and yearly keys", () => {
    const ref = new Date("2026-08-15T12:00:00Z");
    expect(resolvePeriod({ type: "QUARTERLY" }, ref, TZ).key).toBe("2026-Q3");
    expect(resolvePeriod({ type: "YEARLY" }, ref, TZ).key).toBe("2026");
  });

  it("uses the provided range for custom periods", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-31T00:00:00Z");
    const res = resolvePeriod(
      { type: "CUSTOM", startDate: from, endDate: to },
      new Date("2026-06-01T00:00:00Z"),
      TZ,
    );
    expect(res.from).toBe(from);
    expect(res.to).toBe(to);
  });
});
