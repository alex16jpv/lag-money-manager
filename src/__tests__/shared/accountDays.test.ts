import { dayAfter } from "../../shared/accountDays";

describe("dayAfter", () => {
  it("ends the day at the next local midnight in a zone without daylight changes", () => {
    expect(
      dayAfter(new Date("2026-10-01T15:00:00Z"), 14, "America/Bogota"),
    ).toEqual({
      day: "2026-10-15",
      endsAt: new Date("2026-10-16T05:00:00.000Z"),
    });
  });

  it("ends a day that began at 01:00 at the next midnight, not an hour later [T-39]", () => {
    expect(
      dayAfter(new Date("2023-09-30T12:00:00-04:00"), 1, "America/Asuncion"),
    ).toEqual({
      day: "2023-10-01",
      endsAt: new Date("2023-10-02T03:00:00.000Z"),
    });
  });

  it("ends the day before a repeated midnight at the first of the two [T-39]", () => {
    expect(
      dayAfter(new Date("2020-10-30T12:00:00-04:00"), 1, "America/Havana"),
    ).toEqual({
      day: "2020-10-31",
      endsAt: new Date("2020-11-01T04:00:00.000Z"),
    });
  });
});
