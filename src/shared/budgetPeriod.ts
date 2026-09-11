import { DateTime } from "luxon";

import { DomainValidationError } from "../domain/errors";
import { BudgetPeriodType } from "./constants";

export interface BudgetPeriodDef {
  type: BudgetPeriodType;
  startDate?: Date; // CUSTOM only
  endDate?: Date; // CUSTOM only
}

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

  const ref = DateTime.fromJSDate(reference, { zone: timezone });

  if (period.type === "BIWEEKLY") {
    // 2-week windows aligned to a global grid anchored on a fixed Monday.
    const anchor = DateTime.fromISO("2024-01-01T00:00:00", {
      zone: timezone,
    }).startOf("week");
    const weekStart = ref.startOf("week");
    const weeks = Math.floor(weekStart.diff(anchor, "weeks").weeks);
    const from = weekStart.minus({ weeks: ((weeks % 2) + 2) % 2 });
    const to = from.plus({ weeks: 2 });
    return {
      from: from.toJSDate(),
      to: to.toJSDate(),
      key: from.toFormat("kkkk-'BW'WW"),
    };
  }

  const unit =
    period.type === "WEEKLY"
      ? "week"
      : period.type === "MONTHLY"
        ? "month"
        : period.type === "QUARTERLY"
          ? "quarter"
          : "year";

  const start = ref.startOf(unit);
  const end = start.plus({ [`${unit}s`]: 1 });
  return {
    from: start.toJSDate(),
    to: end.toJSDate(),
    key: periodKey(period.type, start),
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
