import { v7 as uuidv7 } from "uuid";

import { BudgetPeriodType, BudgetType, Color } from "../../shared/constants";

export interface BudgetProps {
  id?: string;
  name: string;
  color: Color;
  categoryIds: string[];
  // EXPENSE = spending limit; INCOME = earning goal.
  type?: BudgetType;
  amount: number;
  // Per-period amount overrides keyed by period key (e.g. "2026-12"): the
  // limit for that specific instance instead of the base amount.
  amountOverrides?: Record<string, number>;
  periodType: BudgetPeriodType;
  periodStartDate?: Date | null; // CUSTOM only
  periodEndDate?: Date | null; // CUSTOM only
  // The budget "exists" from here on: past references before this date don't
  // list it. Defaults to createdAt; editable for backdating.
  effectiveFrom?: Date | null;
  note?: string | null;
  userId: string;
  archivedAt?: Date | null;
  createdAt?: Date;
}

export class Budget {
  id: string;
  name: string;
  color: Color;
  categoryIds: string[];
  type: BudgetType;
  amount: number;
  amountOverrides: Record<string, number>;
  periodType: BudgetPeriodType;
  periodStartDate: Date | null;
  periodEndDate: Date | null;
  effectiveFrom: Date | null;
  note: string | null;
  userId: string;
  archivedAt: Date | null;
  createdAt: Date;

  constructor(props: BudgetProps) {
    this.id = props.id ?? uuidv7();
    this.name = props.name;
    this.color = props.color;
    this.categoryIds = props.categoryIds;
    this.type = props.type ?? "EXPENSE";
    this.amount = props.amount;
    this.amountOverrides = props.amountOverrides ?? {};
    this.periodType = props.periodType;
    this.periodStartDate = props.periodStartDate ?? null;
    this.periodEndDate = props.periodEndDate ?? null;
    this.effectiveFrom = props.effectiveFrom ?? null;
    this.note = props.note ?? null;
    this.userId = props.userId;
    this.archivedAt = props.archivedAt ?? null;
    this.createdAt = props.createdAt ?? new Date();
  }

  // Windows that end on or before this instant predate the budget.
  lifetimeFloor(): Date {
    return this.effectiveFrom ?? this.createdAt;
  }

  amountForPeriod(periodKey: string): number {
    return this.amountOverrides[periodKey] ?? this.amount;
  }
}
