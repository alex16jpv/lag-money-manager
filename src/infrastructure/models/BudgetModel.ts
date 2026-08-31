import mongoose, { Schema } from "mongoose";

import {
  BUDGET_PERIOD_TYPES,
  BUDGET_TYPES,
  BudgetPeriodType,
  BudgetType,
  COLORS,
  MODEL_NAMES,
} from "../../shared/constants";

export interface IBudgetDocument {
  _id: string;
  name: string;
  color: string;
  categoryIds: string[];
  type: BudgetType;
  amount: number; // integer cents
  amountOverrides: Map<string, number>; // periodKey -> integer cents
  periodType: BudgetPeriodType;
  periodStartDate: Date | null;
  periodEndDate: Date | null;
  effectiveFrom: Date | null;
  note: string | null;
  userId: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetSchema = new Schema<IBudgetDocument>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    color: { type: String, required: true, enum: Object.keys(COLORS) },
    categoryIds: { type: [String], required: true },
    type: {
      type: String,
      required: true,
      enum: Object.keys(BUDGET_TYPES),
      default: "EXPENSE",
    },
    amount: { type: Number, required: true },
    amountOverrides: { type: Map, of: Number, default: {} },
    periodType: {
      type: String,
      required: true,
      enum: Object.keys(BUDGET_PERIOD_TYPES),
    },
    periodStartDate: { type: Date, default: null },
    periodEndDate: { type: Date, default: null },
    effectiveFrom: { type: Date, default: null },
    note: { type: String, default: null },
    userId: { type: String, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

BudgetSchema.index({ userId: 1, deletedAt: 1 });
// Backs the no-overlap rule (same category + same period type) against
// concurrent creates; multikey over categoryIds, archived budgets free the slot.
BudgetSchema.index(
  { userId: 1, type: 1, periodType: 1, categoryIds: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

export const BudgetModel = mongoose.model<IBudgetDocument>(
  MODEL_NAMES.BUDGET,
  BudgetSchema,
);
