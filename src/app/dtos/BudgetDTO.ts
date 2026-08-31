import { BudgetPeriodType, BudgetType, Color } from "../../shared/constants";

export interface CreateBudgetDTO {
  name: string;
  color: Color;
  categoryIds: string[];
  type?: BudgetType;
  amount: number;
  periodType: BudgetPeriodType;
  periodStartDate?: Date | null;
  periodEndDate?: Date | null;
  effectiveFrom?: Date | null;
  note?: string | null;
  userId: string;
}

export interface UpdateBudgetDTO {
  id?: string;
  name?: string;
  color?: Color;
  categoryIds?: string[];
  type?: BudgetType;
  amount?: number;
  periodType?: BudgetPeriodType;
  periodStartDate?: Date | null;
  periodEndDate?: Date | null;
  effectiveFrom?: Date | null;
  note?: string | null;
}

export interface BudgetView {
  id: string;
  name: string;
  color: Color;
  categoryIds: string[];
  // Subset of categoryIds the user archived: the budget still tracks their
  // history, but the client should flag them.
  archivedCategoryIds: string[];
  type: BudgetType;
  periodType: BudgetPeriodType;
  periodKey: string;
  periodFrom: Date;
  periodTo: Date;
  baseAmount: number;
  amount: number; // resolved for this period (override ?? base)
  spent: number;
  // True when `amount` comes from a per-period override, not the base.
  hasOverride: boolean;
  effectiveFrom: Date;
  note: string | null;
  archivedAt: Date | null;
}
