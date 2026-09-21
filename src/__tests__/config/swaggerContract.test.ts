// The real module, not a mock: this asserts the document the app actually serves.
process.env.JWT_SECRET ??= "swagger-contract-test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.MONGO_URI ??= "mongodb://localhost:27017/unused";

import { swaggerSpec } from "../../config/swagger";
import {
  DEBT_ACCOUNT_FIELD_NAMES,
  MAX_CONTACTS_PER_USER,
  MAX_EXPENSE_GUESTS,
  MAX_GROUP_PARTICIPANTS,
  SPENDING_GROUP_BY,
  SPENDING_SPLIT_BY,
  SPLIT_MODES,
  TRANSACTION_TYPES,
} from "../../shared/constants";
import { ZERO_DECIMAL_CURRENCIES } from "../../shared/currency";
import { ERROR_CODES } from "../../shared/errorCodes";
import { CATEGORY_ICONS } from "../../shared/icons";
import { SYNC_MAX_OPERATIONS, SYNC_OP_STATUSES } from "../../shared/syncBatch";
import { INCOME_REFUSED_ON } from "../../shared/transactionRules";

interface View {
  properties: Record<string, unknown>;
  required?: string[];
}

const spec = swaggerSpec as {
  components: { schemas: Record<string, unknown> };
  paths: Record<string, unknown>;
};
const view = (name: string): View => spec.components.schemas[name] as View;
const descriptions = (): string[] =>
  [
    ...JSON.stringify(spec.paths).matchAll(
      /"description":"((?:[^"\\]|\\.)*)"/g,
    ),
  ].map(([, text]) => text);

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
    "Contact",
    "SharedGroup",
    "SharedGroupTotals",
    "SharedExpense",
    "SharedSplit",
    "SharedShare",
    "AddParticipantsPreview",
    "Transaction",
    "Budget",
    "StatsBucket",
    "StatsSplit",
    "StatsResponse",
    "ErrorResponse",
    "SyncTransaction",
    "SyncBudget",
    "SyncSharedGroup",
    "SyncSettlement",
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
    ["Account", "creditLimit"],
    ["Account", "borrowedAmount"],
    ["Contact", "email"],
    ["Contact", "color"],
    ["SharedGroup", "color"],
    ["SyncSharedGroup", "color"],
  ])(
    "%s leaves %s optional, because it may genuinely be absent",
    (name, field) => {
      expect(view(name).required).not.toContain(field);
      expect(Object.keys(view(name).properties)).toContain(field);
    },
  );

  it("requires every other property of a view", () => {
    const account = view("Account");
    const optional: string[] = [...DEBT_ACCOUNT_FIELD_NAMES];
    expect(account.required).toEqual(
      Object.keys(account.properties).filter((f) => !optional.includes(f)),
    );
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
    ["ContactList", ["data", "pagination"]],
    ["SharedGroupList", ["data", "pagination"]],
    ["SharedExpenseList", ["data", "pagination"]],
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
    expect(view("SharedExpense").required).toContain("deletedAt");
    expect(view("SyncSettlement").required).toContain("deletedAt");
    expect(view("Contact").required).toContain("archivedAt");
    expect(view("SyncSharedGroup").required).toContain("archivedAt");
  });

  // The feed answers with the stored row: totals and status are read-time work nobody did there.
  it("derives SyncSharedGroup from SharedGroup without what a read computes", () => {
    const stored = Object.keys(view("SyncSharedGroup").properties);
    expect(Object.keys(view("SharedGroup").properties)).toEqual([
      ...stored.slice(0, stored.indexOf("currency") + 1),
      "totals",
      "status",
      ...stored.slice(stored.indexOf("currency") + 1),
    ]);
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

  // Hand-written inside `@openapi` comments, so only this holds them to the enum they copy.
  it.each([
    ["/transactions", "get"],
    ["/stats/spending", "get"],
  ])("offers every transaction type on %s", (path, method) => {
    const route = spec.paths[path] as Record<
      string,
      { parameters: { name: string; schema: { enum?: string[] } }[] }
    >;
    const parameter = (route[method]?.parameters ?? []).find(
      (one) => one.name === "type",
    );

    expect(parameter?.schema.enum).toEqual(Object.keys(TRANSACTION_TYPES));
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

  // T-103: the frontend hides these types in its picker, so the list has to be the server's own.
  it("publishes the account types an income cannot land on", () => {
    const refused = spec.components.schemas.IncomeRefusedAccountType as {
      type: string;
      enum: string[];
      description?: string;
    };
    expect(refused.type).toBe("string");
    expect(refused.enum).toEqual([...INCOME_REFUSED_ON]);
    expect(refused.description).toContain("INCOME_ON_CARD_OR_LOAN");
  });

  it("sends every description that names the refusal to that schema", () => {
    const glosses = descriptions().filter((d) =>
      d.includes("INCOME_ON_CARD_OR_LOAN"),
    );
    expect(glosses.length).toBeGreaterThan(0);
    for (const gloss of glosses)
      expect(gloss).toContain("`IncomeRefusedAccountType`");
  });

  // T-67: the client refuses to type a decimal in these, so it has to read the server's own list.
  it("publishes the currencies that take no decimals", () => {
    const zero = spec.components.schemas.ZeroDecimalCurrency as {
      type: string;
      enum: string[];
      description?: string;
    };
    expect(zero.type).toBe("string");
    expect(zero.enum).toEqual([...ZERO_DECIMAL_CURRENCIES]);
    expect(zero.description).toContain("AMOUNT_PRECISION");
    // Sorted, because it is read as a list by a human as often as by a generator.
    expect(zero.enum).toEqual([...zero.enum].sort());
  });

  // The sheet that adds a contact names the limit before a save can fail on it, so it has to read it.
  it("publishes the shared-section limits as numbers a client can generate", () => {
    const limits = spec.components.schemas.SharedLimits as {
      properties: {
        maxContactsPerUser: { enum?: number[] };
        maxParticipantsPerGroup: { enum?: number[] };
        maxGuestsPerExpense: { enum?: number[] };
      };
      required: string[];
    };
    expect(limits.properties.maxContactsPerUser.enum).toEqual([
      MAX_CONTACTS_PER_USER,
    ]);
    expect(limits.properties.maxParticipantsPerGroup.enum).toEqual([
      MAX_GROUP_PARTICIPANTS,
    ]);
    expect(limits.properties.maxGuestsPerExpense.enum).toEqual([
      MAX_EXPENSE_GUESTS,
    ]);
    expect(limits.required).toContain("maxContactsPerUser");
  });

  // The split sheet paints one control per mode, so the list has to be the server's own.
  it("publishes the split modes on the response view and on the request body", () => {
    const mode = view("SharedSplit").properties.mode as { enum?: string[] };
    expect(mode.enum).toEqual(Object.keys(SPLIT_MODES));
    const input = spec.components.schemas.CreateSharedExpenseInput as {
      properties: { split: { properties: { mode: { enum?: string[] } } } };
    };
    expect(input.properties.split.properties.mode.enum).toEqual(mode.enum);
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
