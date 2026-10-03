import { DateTime } from "luxon";

import { DomainValidationError } from "../domain/errors";

export const DELETED_ACCOUNT_KEPT_DAYS = 30;
export const CONFIRM_DEADLINE_DAYS = 14;
export const CONFIRM_REMINDER_DAYS = 4;

export interface WholeDay {
  // "YYYY-MM-DD" in the account's time zone.
  day: string;
  // The start of the next day there: the instant the day is over.
  endsAt: Date;
}

const localDay = (date: Date, timezone: string): DateTime => {
  const local = DateTime.fromJSDate(date, { zone: timezone });
  if (!local.isValid) {
    throw new DomainValidationError(
      `Cannot resolve the account's day: ${local.invalidReason}`,
      "timezone",
    );
  }
  return local.startOf("day");
};

// "Kept until October 28" and "confirm by October 12" last to the end of that day where the account lives.
export function dayAfter(from: Date, days: number, timezone: string): WholeDay {
  const day = localDay(from, timezone).plus({ days });
  return {
    day: day.toFormat("yyyy-MM-dd"),
    endsAt: day.plus({ days: 1 }).toJSDate(),
  };
}

// Whole days from today to the given day, where the account lives: 0 on the day itself.
export function daysUntil(day: string, now: Date, timezone: string): number {
  const target = DateTime.fromISO(day, { zone: timezone }).startOf("day");
  return Math.round(target.diff(localDay(now, timezone), "days").days);
}
