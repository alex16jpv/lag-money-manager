// The real module is loaded, not a mock: the point is to assert the document
// the app actually serves. It only needs the environment to parse.
process.env.JWT_SECRET ??= "swagger-contract-test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.MONGO_URI ??= "mongodb://localhost:27017/unused";

import { swaggerSpec } from "../../config/swagger";
import { ERROR_CODES } from "../../shared/errorCodes";
import { CATEGORY_ICONS } from "../../shared/icons";

interface View {
  properties: Record<string, unknown>;
  required?: string[];
}

const spec = swaggerSpec as {
  components: { schemas: Record<string, View> };
  paths: Record<string, unknown>;
};
const view = (name: string): View => spec.components.schemas[name];

// The frontend generates its types from this document. A view without
// `required` makes every field optional downstream, and an enum left as a free
// string makes the frontend transcribe a list by hand — both were reported as
// friction from the redesign (BACKEND-DESDE-FRONT.md, W-06).
describe("OpenAPI response views", () => {
  it.each([
    "Message",
    "Pagination",
    "User",
    "AuthTokens",
    "Session",
    "Account",
    "Category",
    "Transaction",
    "Budget",
    "StatsBucket",
    "StatsResponse",
    "ErrorResponse",
    "SyncTransaction",
    "SyncBudget",
    "SyncChangesResponse",
  ])("%s declares which fields are always present", (name) => {
    const v = view(name);
    expect(v.required).toBeDefined();
    expect(v.required?.length).toBeGreaterThan(0);
  });

  it.each([
    ["User", "reactivated"],
    ["Category", "seedKey"],
    ["Session", "userAgent"],
  ])(
    "%s leaves %s optional, because it may genuinely be absent",
    (name, field) => {
      expect(view(name).required).not.toContain(field);
      expect(Object.keys(view(name).properties)).toContain(field);
    },
  );

  it("requires every other property of a view", () => {
    const account = view("Account");
    expect(account.required).toEqual(Object.keys(account.properties));
  });

  // W-30: an optional `current` would make the front null-check a flag the
  // API always sends.
  it("Session always says whether it is the caller's own", () => {
    expect(view("Session").required).toContain("current");
    expect(view("Session").properties.current).toMatchObject({
      type: "boolean",
    });
  });

  // The envelopes were the other half of W-06: a `data` typed as optional makes
  // every list consumer null-check an array the API always sends.
  it.each([
    ["AccountList", ["data", "pagination"]],
    ["CategoryList", ["data", "pagination"]],
    ["TransactionList", ["data", "pagination"]],
    ["BudgetList", ["data", "pagination"]],
    ["SessionList", ["data"]],
    ["TagList", ["data"]],
    ["RestoreDefaultsResponse", ["data"]],
  ])("%s requires %s", (name, required) => {
    expect(view(name).required).toEqual(required);
  });

  it("leaves no list response defined inline in a route", () => {
    const inline = JSON.stringify(spec.paths).match(/"properties":\{"data":/g);
    expect(inline).toBeNull();
  });

  // The change feed is the only place a client is told something disappeared,
  // so the two tombstone fields cannot be optional downstream.
  it("keeps the sync feed's tombstones mandatory", () => {
    expect(view("SyncTransaction").required).toContain("deletedAt");
    expect(view("SyncBudget").required).toContain("archivedAt");
  });

  it("derives SyncTransaction from the Transaction view instead of copying it", () => {
    const tx = Object.keys(view("Transaction").properties);
    expect(Object.keys(view("SyncTransaction").properties)).toEqual([
      ...tx,
      "deletedAt",
    ]);
  });

  it("publishes the error codes as an enum the frontend can derive", () => {
    const code = view("ErrorResponse").properties.code as { enum?: string[] };
    expect(code.enum).toEqual([...ERROR_CODES]);
  });

  it("publishes the icon enum on the response view, not just the request body", () => {
    const icon = view("Category").properties.icon as { enum?: string[] };
    expect(icon.enum).toEqual([...CATEGORY_ICONS]);
    const input = spec.components.schemas.CreateCategoryInput as {
      properties: { icon: { enum?: string[] } };
    };
    expect(icon.enum).toEqual(input.properties.icon.enum);
  });
});
