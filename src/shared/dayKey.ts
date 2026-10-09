import { DateTime } from "luxon";

import { DomainValidationError } from "../domain/errors";

/**
 * The local accounting day of an instant, as "YYYY-MM-DD" in the account's
 * timezone. Stamped when a transaction is written and never recomputed unless
 * its date changes: a period is a set of calendar days, so a later change of
 * the account's timezone cannot move a past expense to another day, month or
 * budget period.
 */
export function dayKeyOf(date: Date, timezone: string): string {
  const local = DateTime.fromJSDate(date, { zone: timezone });
  if (!local.isValid) {
    throw new DomainValidationError(
      `Cannot resolve the accounting day: ${local.invalidReason}`,
      "timezone",
    );
  }
  return local.toFormat("yyyy-MM-dd");
}

/** The last day a half-open instant window [from, to) includes. */
export function lastDayKeyOf(exclusiveEnd: Date, timezone: string): string {
  return dayKeyOf(new Date(exclusiveEnd.getTime() - 1), timezone);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A repeated midnight starts the day at the first of the two; a skipped one, at the first instant after the jump.
export function localDayStart(day: string, timezone: string): Date {
  const target = DateTime.fromISO(day, { zone: "utc" }).toMillis();
  const offsetAt = (ms: number): number =>
    DateTime.fromMillis(ms, { zone: timezone }).offset * 60_000;
  const sides = [
    target - offsetAt(target - DAY_MS),
    target - offsetAt(target + DAY_MS),
  ];
  const real = sides.filter(
    (ms) =>
      DateTime.fromMillis(ms, { zone: timezone }).toFormat(
        "yyyy-MM-dd'T'HH:mm",
      ) === `${day}T00:00`,
  );
  return new Date(real.length > 0 ? Math.min(...real) : Math.max(...sides));
}
