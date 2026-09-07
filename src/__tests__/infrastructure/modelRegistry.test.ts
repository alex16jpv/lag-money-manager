jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: { NODE_ENV: "test" },
  MODEL_NAMES: {
    USER: "User",
    ACCOUNT: "Account",
    TRANSACTION: "Transaction",
    CATEGORY: "Category",
    BUDGET: "Budget",
  },
  ACCOUNT_TYPES: { CASH: "CASH", ACCOUNT: "ACCOUNT", OTHER: "OTHER" },
  COLORS: { RED: "RED", GREEN: "GREEN" },
  TRANSACTION_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
    ADJUSTMENT: "ADJUSTMENT",
  },
  TRANSACTION_SOURCES: { MANUAL: "MANUAL", QUICK: "QUICK", IMPORT: "IMPORT" },
  CATEGORY_TYPES: {
    INCOME: "INCOME",
    EXPENSE: "EXPENSE",
    TRANSFER: "TRANSFER",
  },
  BUDGET_TYPES: { EXPENSE: "EXPENSE", INCOME: "INCOME" },
  BUDGET_PERIOD_TYPES: { MONTHLY: "MONTHLY", CUSTOM: "CUSTOM" },
}));

import { readdirSync } from "fs";
import { join } from "path";

import mongoose from "mongoose";

import * as registry from "../../infrastructure/models";

const MODELS_DIR = join(__dirname, "../../infrastructure/models");

// The deploy step syncs whatever is registered here. A model missing from the
// barrel gets no indexes in production — that is how RefreshSession lost its
// TTL and familyId indexes.
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
