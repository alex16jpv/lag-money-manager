import { v7 as uuidv7 } from "uuid";

import { BudgetPeriodType, BudgetType, Color } from "../../shared/constants";

export interface BudgetProps {
  id?: string;
  name: string;
  color: Color;
  categoryIds: string[];
  // EXPENSE = spending limit; INCOME = earning goal.
  type?: BudgetType;
  // ISO 4217; stamped by the server from the owner's currency at creation.
  currency?: string;
  amount: number;
  // Per-period overrides keyed by period key ("2026-12"): that instance's limit, not the base amount.
  amountOverrides?: Record<string, number>;
  periodType: BudgetPeriodType;
  periodStartDate?: Date | null; // CUSTOM only
  periodEndDate?: Date | null; // CUSTOM only
  // The budget exists from here on; defaults to createdAt and is editable for backdating.
  effectiveFrom?: Date | null;
  note?: string | null;
  userId: string;
  archivedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Budget {
  id: string;
  name: string;
  color: Color;
  categoryIds: string[];
  type: BudgetType;
  currency?: string;
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
  updatedAt?: Date;

  constructor(props: BudgetProps) {
    this.id = props.id ?? uuidv7();
    this.name = props.name;
    this.color = props.color;
    this.categoryIds = props.categoryIds;
    this.type = props.type ?? "EXPENSE";
    this.currency = props.currency;
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
    this.updatedAt = props.updatedAt;
  }

  // Windows that end on or before this instant predate the budget.
  lifetimeFloor(): Date {
    const floor = this.effectiveFrom ?? this.createdAt;
    // A CUSTOM window is explicit, so it caps the floor and a backdated budget still lists.
    if (
      this.periodType === "CUSTOM" &&
      this.periodStartDate &&
      this.periodStartDate.getTime() < floor.getTime()
    ) {
      return this.periodStartDate;
    }
    return floor;
  }

  amountForPeriod(periodKey: string): number {
    return this.amountOverrides[periodKey] ?? this.amount;
  }
}
