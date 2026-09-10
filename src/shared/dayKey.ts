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
