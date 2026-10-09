import { DateTime } from "luxon";

import { DomainValidationError } from "../domain/errors";
import { BudgetPeriodType } from "./constants";
import { localDayStart } from "./dayKey";

export interface BudgetPeriodDef {
  type: BudgetPeriodType;
  startDate?: Date; // CUSTOM only
  endDate?: Date; // CUSTOM only
}

export type RecurringPeriodType = Exclude<BudgetPeriodType, "CUSTOM">;

export interface ResolvedPeriod {
  from: Date;
  to: Date; // exclusive
  key: string;
}

// Window [from, to) and a stable key for the instance `reference` falls into, in the user's zone.
export function resolvePeriod(
  period: BudgetPeriodDef,
  reference: Date,
  timezone: string,
): ResolvedPeriod {
  // An Invalid Date would produce the key "Invalid DateTime" and persist corrupt overrides.
  if (isNaN(reference.getTime())) {
    throw new DomainValidationError("Invalid reference date", "reference");
  }

  if (period.type === "CUSTOM") {
    if (!period.startDate || !period.endDate) {
      throw new Error("Custom period requires startDate and endDate");
    }
    return {
      from: period.startDate,
      to: period.endDate,
      // Epoch millis: keys are used as Mongo $set paths, so no dots allowed.
      key: `${period.startDate.getTime()}_${period.endDate.getTime()}`,
    };
  }

  const local = DateTime.fromJSDate(reference, { zone: timezone });
  // Calendar arithmetic in UTC, where no day is skipped or repeated; each edge becomes a local midnight last.
  const day = DateTime.utc(local.year, local.month, local.day);
  const window = (
    from: DateTime,
    to: DateTime,
    key: string,
  ): ResolvedPeriod => ({
    from: localDayStart(dayOf(from), timezone),
    to: localDayStart(dayOf(to), timezone),
    key,
  });

  if (period.type === "BIWEEKLY") {
    // 2-week windows aligned to a global grid anchored on a fixed Monday.
    const anchor = DateTime.utc(2024, 1, 1).startOf("week");
    const weekStart = day.startOf("week");
    const weeks = Math.round(weekStart.diff(anchor, "weeks").weeks);
    const from = weekStart.minus({ weeks: ((weeks % 2) + 2) % 2 });
    return window(from, from.plus({ weeks: 2 }), from.toFormat("kkkk-'BW'WW"));
  }

  const unit =
    period.type === "WEEKLY"
      ? "week"
      : period.type === "MONTHLY"
        ? "month"
        : period.type === "QUARTERLY"
          ? "quarter"
          : "year";

  const start = day.startOf(unit);
  return window(
    start,
    start.plus({ [`${unit}s`]: 1 }),
    periodKey(period.type, start),
  );
}

const dayOf = (calendar: DateTime): string => calendar.toFormat("yyyy-MM-dd");

// Exclusive end of the window `reference` falls into, for every recurring period type.
export function recurringWindowEnds(
  reference: Date,
  timezone: string,
): Record<RecurringPeriodType, Date> {
  const end = (type: RecurringPeriodType): Date =>
    resolvePeriod({ type }, reference, timezone).to;
  return {
    WEEKLY: end("WEEKLY"),
    BIWEEKLY: end("BIWEEKLY"),
    MONTHLY: end("MONTHLY"),
    QUARTERLY: end("QUARTERLY"),
    YEARLY: end("YEARLY"),
  };
}

function periodKey(type: BudgetPeriodType, start: DateTime): string {
  switch (type) {
    case "WEEKLY":
      return start.toFormat("kkkk-'W'WW");
    case "MONTHLY":
      return start.toFormat("yyyy-MM");
    case "QUARTERLY":
      return `${start.year}-Q${start.quarter}`;
    case "YEARLY":
      return start.toFormat("yyyy");
    default:
      // Keys are Mongo $set paths: a fallback with dots would corrupt amountOverrides. Fail loudly.
      throw new Error(`No period key format defined for period type ${type}`);
  }
}
