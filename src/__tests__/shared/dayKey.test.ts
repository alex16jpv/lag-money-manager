import { DomainValidationError } from "../../domain/errors";
import { dayKeyOf, lastDayKeyOf } from "../../shared/dayKey";

describe("dayKeyOf", () => {
  it("resolves the day in the account's zone, not in UTC", () => {
    // 11pm on Sep 30 in Bogota (UTC-5) is Oct 1 in UTC.
    const instant = new Date("2026-10-01T04:00:00.000Z");
    expect(dayKeyOf(instant, "America/Bogota")).toBe("2026-09-30");
    expect(dayKeyOf(instant, "UTC")).toBe("2026-10-01");
    expect(dayKeyOf(instant, "Europe/Madrid")).toBe("2026-10-01");
    expect(dayKeyOf(instant, "Asia/Tokyo")).toBe("2026-10-01");
  });

  it("resolves midnight and the last millisecond of a local day", () => {
    expect(
      dayKeyOf(new Date("2026-09-01T05:00:00.000Z"), "America/Bogota"),
    ).toBe("2026-09-01");
    expect(
      dayKeyOf(new Date("2026-09-01T04:59:59.999Z"), "America/Bogota"),
    ).toBe("2026-08-31");
  });

  it("follows the offset in force that day, not today's", () => {
    // Madrid is UTC+1 in winter and UTC+2 in summer: the same clock time in UTC
    // falls on a different local day depending on the season.
    expect(
      dayKeyOf(new Date("2026-01-31T23:30:00.000Z"), "Europe/Madrid"),
    ).toBe("2026-02-01");
    expect(
      dayKeyOf(new Date("2026-07-31T23:30:00.000Z"), "Europe/Madrid"),
    ).toBe("2026-08-01");
    expect(
      dayKeyOf(new Date("2026-07-31T21:30:00.000Z"), "Europe/Madrid"),
    ).toBe("2026-07-31");
  });

  it("refuses to invent a day from a zone it cannot read", () => {
    expect(() => dayKeyOf(new Date(), "Mars/Olympus")).toThrow(
      DomainValidationError,
    );
  });
});

describe("lastDayKeyOf", () => {
  it("names the last day a half-open window includes", () => {
    // A September window in Bogota: [Sep 1 00:00, Oct 1 00:00).
    expect(
      lastDayKeyOf(new Date("2026-10-01T05:00:00.000Z"), "America/Bogota"),
    ).toBe("2026-09-30");
  });

  it("keeps a window that ends mid-day inside that day", () => {
    expect(
      lastDayKeyOf(new Date("2026-09-15T17:00:00.000Z"), "America/Bogota"),
    ).toBe("2026-09-15");
  });
});
