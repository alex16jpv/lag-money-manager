jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: { NODE_ENV: "test" },
  ACCOUNT_TYPES: {},
  COLORS: {},
  CATEGORY_TYPES: {},
  TRANSACTION_TYPES: {},
  TRANSACTION_SOURCES: {},
  BUDGET_TYPES: {},
  BUDGET_PERIOD_TYPES: {},
  DB_TYPES: { MONGO: "MONGO" },
  MODEL_NAMES: {},
}));

import { Request } from "express";

import { ifMatch } from "../../app/controllers/ifMatch";

const req = (value?: string): Request =>
  ({ get: () => value }) as unknown as Request;

describe("ifMatch", () => {
  it("is absent when the client sends no header", () => {
    expect(ifMatch(req(undefined))).toBeUndefined();
  });

  it("parses the updatedAt the API prints", () => {
    expect(ifMatch(req("2026-09-03T18:00:00.000Z"))).toEqual(
      new Date("2026-09-03T18:00:00.000Z"),
    );
  });

  it("accepts an offset instead of Z (same instant)", () => {
    expect(ifMatch(req("2026-09-03T13:00:00.000-05:00"))).toEqual(
      new Date("2026-09-03T18:00:00.000Z"),
    );
  });

  // A date without a time parses to midnight and would never match a stored
  // updatedAt: better a 400 than a permanent, silent 409.
  it.each(["", "not a date", "2026-09-03", "*", '"2026-09-03T18:00:00.000Z"'])(
    "rejects %p with 400 VALIDATION",
    (raw) => {
      expect(() => ifMatch(req(raw))).toThrow(
        expect.objectContaining({ statusCode: 400, code: "VALIDATION" }),
      );
    },
  );

  it("names the header in details so the client can map the error", () => {
    expect.assertions(1);
    try {
      ifMatch(req("nope"));
    } catch (err) {
      expect((err as { details: unknown }).details).toEqual([
        { field: "If-Match", message: expect.any(String) },
      ]);
    }
  });
});
