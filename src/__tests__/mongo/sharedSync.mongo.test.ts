/**
 * The shared layer through the offline door (T-118): everything it holds
 * travels in the feed with its tombstone, and the batch writes it through the
 * same services the routes call.
 */
import request from "supertest";

import app from "../../app";
import { swaggerSpec } from "../../config/swagger";
import { connect, disconnect, dropDatabase } from "./support";

interface Session {
  token: string;
  userId: string;
}

interface Operation {
  opId: string;
  seq: number;
  occurredAt: string;
  opVersion: number;
  entity: string;
  action: string;
  id: string;
  payload?: Record<string, unknown>;
  baseUpdatedAt?: string;
}

const ACCOUNT_ID = "019576a0-d7b6-7d6d-af6a-2b7545700001";
const CONTACT_ID = "019576a0-d7b6-7d6d-af6a-2b7545700002";
const GROUP_ID = "019576a0-d7b6-7d6d-af6a-2b7545700003";
const EXPENSE_ID = "019576a0-d7b6-7d6d-af6a-2b7545700004";
const SETTLEMENT_ID = "019576a0-d7b6-7d6d-af6a-2b7545700005";
const RESPLIT_GROUP_ID = "019576a0-d7b6-7d6d-af6a-2b7545700020";
const RESPLIT_CONTACTS = [
  "019576a0-d7b6-7d6d-af6a-2b7545700021",
  "019576a0-d7b6-7d6d-af6a-2b7545700022",
];
const RESPLIT_EXPENSES = [
  "019576a0-d7b6-7d6d-af6a-2b7545700023",
  "019576a0-d7b6-7d6d-af6a-2b7545700024",
  "019576a0-d7b6-7d6d-af6a-2b7545700025",
];

interface View {
  properties: Record<string, unknown>;
  required?: string[];
}

const view = (name: string): View =>
  (swaggerSpec as { components: { schemas: Record<string, View> } }).components
    .schemas[name];

let opCounter = 0;
const op = (
  over: Partial<Operation> & Pick<Operation, "entity" | "action" | "id">,
): Operation => ({
  opId: `019576a0-d7b6-7d6d-af6a-2b75457f${String(++opCounter).padStart(4, "0")}`,
  seq: opCounter,
  occurredAt: "2026-09-05T10:00:00.000Z",
  opVersion: 1,
  ...over,
});

describe("the shared layer through sync, against mongod", () => {
  let session: Session;

  const as = (req: request.Test): request.Test =>
    req.set("Authorization", `Bearer ${session.token}`);

  const push = async (
    operations: Operation[],
  ): Promise<{ status: string; code?: string; message?: string }[]> => {
    const res = await as(request(app).post("/sync").send({ operations }));
    expect(res.status).toBe(200);
    return res.body.results;
  };

  const feed = async (): Promise<Record<string, { id: string }[]>> => {
    const res = await as(request(app).get("/sync/changes?limit=100"));
    expect(res.status).toBe(200);
    return res.body.changes;
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const registered = await request(app).post("/auth/register").send({
      name: "Owner",
      email: "owner@shared-sync.test",
      password: "Offline!2026",
    });
    expect(registered.status).toBe(201);
    session = {
      token: registered.body.accessToken,
      userId: registered.body.user.id,
    };
    expect(
      (
        await as(
          request(app).post("/accounts").send({
            id: ACCOUNT_ID,
            name: "Bancolombia",
            type: "ACCOUNT",
            balance: 5_000_000,
          }),
        )
      ).status,
    ).toBe(201);
  }, 30_000);

  afterAll(async () => {
    await disconnect();
  });

  it("writes a whole outing from the outbox, in one batch", async () => {
    const results = await push([
      op({
        entity: "contact",
        action: "create",
        id: CONTACT_ID,
        payload: { body: { name: "Ana" } },
      }),
      op({
        entity: "sharedGroup",
        action: "create",
        id: GROUP_ID,
        payload: { body: { name: "Night out", contactIds: [CONTACT_ID] } },
      }),
      op({
        entity: "sharedExpense",
        action: "create",
        id: EXPENSE_ID,
        payload: {
          params: { groupId: GROUP_ID },
          body: {
            description: "Dinner",
            date: "2026-08-10T18:00:00.000Z",
            amount: 90_000,
          },
        },
      }),
      op({
        entity: "settlement",
        action: "create",
        id: SETTLEMENT_ID,
        payload: {
          body: {
            contactId: CONTACT_ID,
            date: "2026-08-25T18:00:00.000Z",
            collected: 20_000,
            accountId: ACCOUNT_ID,
          },
        },
      }),
    ]);

    expect(results.map((one) => one.status)).toEqual([
      "applied",
      "applied",
      "applied",
      "applied",
    ]);
    const group = await as(request(app).get(`/shared-groups/${GROUP_ID}`));
    expect(group.body.totals.amount).toBe(90_000);
    expect(group.body.totals.collected).toBe(20_000);
  });

  it("carries all of it in the feed, and says so when something goes", async () => {
    const before = await feed();
    expect(before.contacts.map((row) => row.id)).toContain(CONTACT_ID);
    expect(before.sharedGroups.map((row) => row.id)).toContain(GROUP_ID);
    expect(before.sharedExpenses.map((row) => row.id)).toContain(EXPENSE_ID);
    expect(before.settlements.map((row) => row.id)).toContain(SETTLEMENT_ID);

    await push([
      op({ entity: "settlement", action: "delete", id: SETTLEMENT_ID }),
      op({
        entity: "sharedExpense",
        action: "delete",
        id: EXPENSE_ID,
        payload: { params: { groupId: GROUP_ID } },
      }),
      op({ entity: "sharedGroup", action: "archive", id: GROUP_ID }),
      op({ entity: "contact", action: "archive", id: CONTACT_ID }),
    ]);

    const after = await feed();
    const row = (kind: string, id: string): Record<string, unknown> =>
      (after[kind] as unknown as Record<string, unknown>[]).find(
        (one) => one.id === id,
      ) as Record<string, unknown>;
    // The only way a device holding a copy learns that something disappeared.
    expect(row("settlements", SETTLEMENT_ID).deletedAt).not.toBeNull();
    expect(row("sharedExpenses", EXPENSE_ID).deletedAt).not.toBeNull();
    expect(row("sharedGroups", GROUP_ID).archivedAt).not.toBeNull();
    expect(row("contacts", CONTACT_ID).archivedAt).not.toBeNull();
  });

  it("carries nothing private in the shared rows", async () => {
    const changes = await feed();
    const shared = [
      ...(changes.sharedGroups as unknown as Record<string, unknown>[]),
      ...(changes.sharedExpenses as unknown as Record<string, unknown>[]),
      ...(changes.settlements as unknown as Record<string, unknown>[]),
    ];

    for (const one of shared) {
      for (const field of [
        "accountId",
        "fromAccountId",
        "toAccountId",
        "categoryId",
        "countsAsYours",
        "transactionId",
        "sharedHistory",
      ]) {
        expect(one).not.toHaveProperty(field);
      }
    }
  });

  // The list above only catches what somebody thought of: this one catches everything else.
  it("carries in every shared row exactly the fields the OpenAPI declares", async () => {
    const changes = await feed();
    const rowsOf = (key: string): Record<string, unknown>[] =>
      changes[key] as unknown as Record<string, unknown>[];

    const check = (row: Record<string, unknown>, name: string): void => {
      const declared = Object.keys(view(name).properties);
      expect({
        [name]: Object.keys(row).filter((key) => !declared.includes(key)),
      }).toEqual({ [name]: [] });
      expect({
        [name]: (view(name).required ?? []).filter((key) => !(key in row)),
      }).toEqual({ [name]: [] });
    };

    for (const [key, name] of [
      ["contacts", "Contact"],
      ["sharedGroups", "SyncSharedGroup"],
      ["sharedExpenses", "SharedExpense"],
      ["settlements", "SyncSettlement"],
    ] as const) {
      expect(rowsOf(key).length).toBeGreaterThan(0);
      for (const row of rowsOf(key)) check(row, name);
    }

    for (const group of rowsOf("sharedGroups")) {
      for (const one of group.participants as Record<string, unknown>[]) {
        check(one, "SharedGroupParticipant");
      }
    }
    for (const expense of rowsOf("sharedExpenses")) {
      const split = expense.split as Record<string, unknown>;
      check(split, "SharedSplit");
      for (const share of split.shares as Record<string, unknown>[]) {
        check(share, "SharedShare");
      }
    }
  });

  it("rejects the operation, not the batch, when the path it needs is missing", async () => {
    const [result] = await push([
      op({
        entity: "sharedExpense",
        action: "create",
        id: "019576a0-d7b6-7d6d-af6a-2b75457000ff",
        payload: {
          body: {
            description: "Nowhere",
            date: "2026-08-10T18:00:00.000Z",
            amount: 1000,
          },
        },
      }),
    ]);

    expect(result?.status).toBe("rejected");
    expect(result?.code).toBe("VALIDATION");
  });

  it("answers a resent operation as one that already landed", async () => {
    const again = op({
      entity: "contact",
      action: "create",
      id: "019576a0-d7b6-7d6d-af6a-2b7545700010",
      payload: { body: { name: "Beto" } },
    });

    const first = await push([again]);
    const second = await push([again]);

    expect(first[0]?.status).toBe("applied");
    expect(second[0]?.status).toBe("duplicate");
  });

  // One write, many rows changed: what the mocks cannot see is that all of them travel.
  it("brings back every expense a new participant re-split", async () => {
    await push([
      ...RESPLIT_CONTACTS.map((id, i) =>
        op({
          entity: "contact",
          action: "create",
          id,
          payload: { body: { name: `Resplit ${i}` } },
        }),
      ),
      op({
        entity: "sharedGroup",
        action: "create",
        id: RESPLIT_GROUP_ID,
        payload: {
          body: { name: "Trip", contactIds: [RESPLIT_CONTACTS[0]] },
        },
      }),
      ...RESPLIT_EXPENSES.map((id, i) =>
        op({
          entity: "sharedExpense",
          action: "create",
          id,
          payload: {
            params: { groupId: RESPLIT_GROUP_ID },
            body: {
              description: `Leg ${i}`,
              date: `2026-08-1${i}T18:00:00.000Z`,
              amount: 60_000,
            },
          },
        }),
      ),
    ]);

    const before = await as(request(app).get("/sync/changes?limit=100"));
    const since = before.body.serverTime as string;

    const [added] = await push([
      op({
        entity: "sharedGroup",
        action: "addParticipants",
        id: RESPLIT_GROUP_ID,
        payload: {
          body: {
            contactIds: [RESPLIT_CONTACTS[1]],
            applyToExistingExpenses: true,
          },
        },
      }),
    ]);
    expect(added?.status).toBe("applied");

    const res = await as(
      request(app).get(
        `/sync/changes?limit=100&since=${encodeURIComponent(since)}`,
      ),
    );
    expect(res.status).toBe(200);
    const expenses = (
      res.body.changes.sharedExpenses as {
        id: string;
        split: { shares: { amount: number }[] };
      }[]
    ).filter((one) => RESPLIT_EXPENSES.includes(one.id));

    expect(expenses.map((one) => one.id).sort()).toEqual(
      [...RESPLIT_EXPENSES].sort(),
    );
    for (const expense of expenses) {
      expect(expense.split.shares.map((share) => share.amount)).toEqual([
        20_000, 20_000, 20_000,
      ]);
    }
  });
});
