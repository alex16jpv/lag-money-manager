jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: { NODE_ENV: "test" },
  MODEL_NAMES: {
    USER: "User",
    ACCOUNT: "Account",
    TRANSACTION: "Transaction",
    CATEGORY: "Category",
    BUDGET: "Budget",
    CONTACT: "Contact",
    SHARED_GROUP: "SharedGroup",
    SHARED_EXPENSE: "SharedExpense",
    SHARED_SETTLEMENT: "SharedSettlement",
    SHARED_INVITATION: "SharedInvitation",
  },
  ACCOUNT_TYPES: { CASH: "CASH", ACCOUNT: "ACCOUNT", OTHER: "OTHER" },
  COLORS: { RED: "RED", GREEN: "GREEN" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
    ADJUSTMENT: "ADJUSTMENT",
    SETTLEMENT: "SETTLEMENT",
  },
  TRANSACTION_SOURCES: { MANUAL: "MANUAL", QUICK: "QUICK", IMPORT: "IMPORT" },
  CATEGORY_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
  },
  BUDGET_TYPES: { EXPENSE: "EXPENSE", INCOME: "INCOME" },
  BUDGET_PERIOD_TYPES: { MONTHLY: "MONTHLY", CUSTOM: "CUSTOM" },
  GROUP_SPLIT_MODES: { EQUAL: "EQUAL", PERCENT: "PERCENT" },
  SPLIT_MODES: {
    EQUAL: "EQUAL",
    PERCENT: "PERCENT",
    EXACT: "EXACT",
    FIXED_REST: "FIXED_REST",
  },
  SHARE_PARTIES: { USER: "USER", CONTACT: "CONTACT", GUESTS: "GUESTS" },
  SHARED_HISTORY_REASONS: {
    SPLIT: "SPLIT",
    SPLIT_EDITED: "SPLIT_EDITED",
    AMOUNT_CHANGED: "AMOUNT_CHANGED",
    UNSPLIT: "UNSPLIT",
    PAYMENT: "PAYMENT",
    REIMPUTED: "REIMPUTED",
  },
  TYPES_OUTSIDE_SPENDING: ["ADJUSTMENT", "SETTLEMENT"],
  TYPES_RECORDED_ELSEWHERE: ["SETTLEMENT"],
  SETTLEMENT_PARTIES: { CONTACT: "CONTACT", GUESTS: "GUESTS" },
  GROUP_STATUSES: { OPEN: "OPEN", SETTLED: "SETTLED" },
  INVITATION_STATUSES: {
    PENDING: "PENDING",
    ACCEPTED: "ACCEPTED",
    DECLINED: "DECLINED",
    WITHDRAWN: "WITHDRAWN",
  },
}));

import { readdirSync } from "fs";
import mongoose from "mongoose";
import { join } from "path";

import * as registry from "../../infrastructure/models";

const MODELS_DIR = join(__dirname, "../../infrastructure/models");

// A model missing from the barrel gets no indexes in production: that is how RefreshSession lost its.
describe("model registry", () => {
  const modelFiles = readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith("Model.ts"))
    .map((f) => f.replace(/\.ts$/, ""));

  it("exports every *Model.ts file in the directory", () => {
    const exported = Object.keys(registry);
    expect(modelFiles.length).toBeGreaterThan(0);
    expect(exported.sort()).toEqual(modelFiles.sort());
  });

  it("registers each of them with Mongoose", () => {
    expect(Object.keys(mongoose.models).length).toBe(modelFiles.length);
  });
});
