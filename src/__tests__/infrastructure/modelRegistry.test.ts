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
