import { v7 as uuidv7 } from "uuid";

import { BudgetPeriodType, Color } from "../../shared/constants";

export interface BudgetProps {
  id?: string;
  name: string;
  color: Color;
  categoryIds: string[];
  amount: number;
  // Per-period amount overrides keyed by period key (e.g. "2026-12"): the
  // limit for that specific instance instead of the base amount.
  amountOverrides?: Record<string, number>;
  periodType: BudgetPeriodType;
  periodStartDate?: Date | null; // CUSTOM only
  periodEndDate?: Date | null; // CUSTOM only
  note?: string | null;
  userId: string;
  archivedAt?: Date | null;
}

export class Budget {
  id: string;
  name: string;
  color: Color;
  categoryIds: string[];
  amount: number;
  amountOverrides: Record<string, number>;
  periodType: BudgetPeriodType;
  periodStartDate: Date | null;
  periodEndDate: Date | null;
  note: string | null;
  userId: string;
  archivedAt: Date | null;

  constructor(props: BudgetProps) {
    this.id = props.id ?? uuidv7();
    this.name = props.name;
    this.color = props.color;
    this.categoryIds = props.categoryIds;
    this.amount = props.amount;
    this.amountOverrides = props.amountOverrides ?? {};
    this.periodType = props.periodType;
    this.periodStartDate = props.periodStartDate ?? null;
    this.periodEndDate = props.periodEndDate ?? null;
    this.note = props.note ?? null;
    this.userId = props.userId;
    this.archivedAt = props.archivedAt ?? null;
  }

  amountForPeriod(periodKey: string): number {
    return this.amountOverrides[periodKey] ?? this.amount;
  }
}
