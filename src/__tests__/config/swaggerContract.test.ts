// The real module, not a mock: this asserts the document the app actually serves.
process.env.JWT_SECRET ??= "swagger-contract-test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.MONGO_URI ??= "mongodb://localhost:27017/unused";

import { swaggerSpec } from "../../config/swagger";
import { SPENDING_GROUP_BY, SPENDING_SPLIT_BY } from "../../shared/constants";
import { ERROR_CODES } from "../../shared/errorCodes";
import { CATEGORY_ICONS } from "../../shared/icons";
import { SYNC_MAX_OPERATIONS, SYNC_OP_STATUSES } from "../../shared/syncBatch";

interface View {
  properties: Record<string, unknown>;
  required?: string[];
}

const spec = swaggerSpec as {
  components: { schemas: Record<string, View> };
  paths: Record<string, unknown>;
};
const view = (name: string): View => spec.components.schemas[name];

// W-06: a view without `required` makes every field optional downstream, and a free string hides enums.
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
    "StatsSplit",
    "StatsResponse",
    "ErrorResponse",
    "SyncTransaction",
    "SyncBudget",
    "SyncChangesResponse",
    "SyncOpResult",
    "SyncBatchResponse",
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

  // W-30: an optional `current` would make the front null-check a flag the API always sends.
  it("Session always says whether it is the caller's own", () => {
    expect(view("Session").required).toContain("current");
    expect(view("Session").properties.current).toMatchObject({
      type: "boolean",
    });
  });

  // W-06: an optional `data` makes every list consumer null-check an array that always arrives.
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

  // The feed is the only place a client hears a row vanished, so the tombstones cannot be optional.
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

  // The charts branch on these, and the four views of Stats are exactly this enum.
  it("publishes the spending dimensions as the server's own enums", () => {
    const stats = view("StatsResponse");
    expect((stats.properties.groupBy as { enum: string[] }).enum).toEqual(
      Object.keys(SPENDING_GROUP_BY),
    );
    expect((stats.properties.splitBy as { enum: string[] }).enum).toEqual(
      Object.keys(SPENDING_SPLIT_BY),
    );
  });

  // The query parameters are hand-written YAML inside a comment; only this holds them to the enum.
  it.each([
    ["groupBy", SPENDING_GROUP_BY],
    ["splitBy", SPENDING_SPLIT_BY],
  ])("offers %s as a query parameter with the same values", (name, values) => {
    const spending = spec.paths["/stats/spending"] as {
      get: { parameters: { name: string; schema: { enum?: string[] } }[] };
    };
    const parameter = spending.get.parameters.find((p) => p.name === name);

    expect(parameter?.schema.enum).toEqual(Object.keys(values));
  });

  // O-F5b branches on this answer, so its status and code lists must be the server's, not a copy.
  it("publishes the batch statuses and codes as enums", () => {
    const result = view("SyncOpResult");
    expect((result.properties.status as { enum: string[] }).enum).toEqual([
      ...SYNC_OP_STATUSES,
    ]);
    expect((result.properties.code as { enum: string[] }).enum).toEqual([
      ...ERROR_CODES,
    ]);
    expect(result.required).toEqual(["opId", "seq", "entity", "id", "status"]);
    expect(view("SyncBatchResponse").required).toEqual([
      "serverTime",
      "results",
    ]);
  });

  it("generates the batch request body from the Zod schema", () => {
    const input = spec.components.schemas.SyncBatchInput as unknown as {
      properties: {
        operations: {
          maxItems: number;
          items: { required: string[]; properties: Record<string, unknown> };
        };
      };
    };
    expect(input.properties.operations.maxItems).toBe(SYNC_MAX_OPERATIONS);
    expect(input.properties.operations.items.required).toEqual([
      "opId",
      "seq",
      "occurredAt",
      "entity",
      "action",
      "id",
      "opVersion",
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
