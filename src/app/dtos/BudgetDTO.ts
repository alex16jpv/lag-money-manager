import { BudgetPeriodType, Color } from "../../shared/constants";

export interface CreateBudgetDTO {
  name: string;
  color: Color;
  categoryIds: string[];
  amount: number;
  periodType: BudgetPeriodType;
  periodStartDate?: Date | null;
  periodEndDate?: Date | null;
  note?: string | null;
  userId: string;
}

export interface UpdateBudgetDTO {
  id?: string;
  name?: string;
  color?: Color;
  categoryIds?: string[];
  amount?: number;
  periodType?: BudgetPeriodType;
  periodStartDate?: Date | null;
  periodEndDate?: Date | null;
  note?: string | null;
}

export interface BudgetView {
  id: string;
  name: string;
  color: Color;
  categoryIds: string[];
  periodType: BudgetPeriodType;
  periodKey: string;
  periodFrom: Date;
  periodTo: Date;
  baseAmount: number;
  amount: number; // resolved for this period (override ?? base)
  spent: number;
  note: string | null;
  archivedAt: Date | null;
}
