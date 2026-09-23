/**
 * What the mocked suite cannot see about a group shared with you (T-130): the
 * feed placing a group joined after the cursor at the moment of joining and
 * paging it whole, the partial unique index that lets one line into your
 * ledger once, and leaving.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

interface Session {
  token: string;
  userId: string;
}

type Row = Record<string, unknown>;

async function register(email: string, name: string): Promise<Session> {
  const res = await request(app)
    .post("/auth/register")
    .send({ name, email, password: "Offline!2026", currency: "COP" });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

async function created(req: request.Test): Promise<string> {
  const res = await req;
  expect(res.status).toBe(201);
  return res.body.id as string;
}

interface Pulled {
  groups: Row[];
  expenses: Row[];
  cursor: string;
}

async function pullAll(
  session: Session,
  cursor?: string,
  limit = 1,
): Promise<Pulled> {
  const groups: Row[] = [];
  const expenses: Row[] = [];
  let next = cursor;
  for (let page = 0; page < 50; page++) {
    const res = await as(
      session,
      request(app)
        .get("/sync/changes")
        .query({ limit, ...(next && { cursor: next }) }),
    );
    expect(res.status).toBe(200);
    groups.push(...res.body.changes.joinedGroups);
    expenses.push(...res.body.changes.joinedExpenses);
    next = res.body.pagination.nextCursor;
    if (!res.body.pagination.hasMore) break;
  }
  return { groups, expenses, cursor: next as string };
}

describe("a group shared with you, against mongod", () => {
  let ana: Session;
  let beto: Session;
  let groupId: string;
  let expenseIds: string[];
  let invitationId: string;
  let betoAccount: string;
  let betoCategory: string;
  let betoContact: string;

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    ana = await register("ana@joined.test", "Ana Ruiz");
    beto = await register("beto@joined.test", "Beto Cano");

    betoContact = await created(
      as(
        ana,
        request(app)
          .post("/contacts")
          .send({ name: "Betico", email: "beto@joined.test" }),
      ),
    );
    const marta = await created(
      as(ana, request(app).post("/contacts").send({ name: "Martica" })),
    );
    groupId = await created(
      as(
        ana,
        request(app)
          .post("/shared-groups")
          .send({ name: "Villa de Leyva", contactIds: [betoContact, marta] }),
      ),
    );
    expenseIds = [];
    for (const [description, day] of [
      ["Cabin", "2026-09-19"],
      ["Groceries", "2026-09-19"],
      ["Dinner", "2026-09-20"],
    ]) {
      expenseIds.push(
        await created(
          as(
            ana,
            request(app)
              .post(`/shared-groups/${groupId}/expenses`)
              .send({
                description,
                date: `${day}T15:00:00.000Z`,
                amount: 90000,
              }),
          ),
        ),
      );
    }
    betoAccount = await created(
      as(
        beto,
        request(app)
          .post("/accounts")
          .send({ name: "Nequi", type: "OTHER", balance: 500000 }),
      ),
    );
    const categories = await as(beto, request(app).get("/categories"));
    betoCategory = (
      categories.body.data as { id: string; type: string }[]
    ).find((c) => c.type === "EXPENSE")?.id as string;
  });

  afterAll(async () => {
    await disconnect();
  });

  it("brings a group joined after the cursor whole, even rows older than the cursor, a page at a time", async () => {
    const before = await pullAll(beto, undefined, 200);
    expect(before.groups).toHaveLength(0);

    const invited = await as(
      ana,
      request(app)
        .post(`/shared-groups/${groupId}/invitations`)
        .send({ contactId: betoContact }),
    );
    invitationId = invited.body.id as string;
    const accepted = await as(
      beto,
      request(app).post(`/invitations/${invitationId}/accept`),
    );
    expect(accepted.status).toBe(200);

    const after = await pullAll(beto, before.cursor, 1);

    expect(new Set(after.expenses.map((e) => e.id))).toEqual(
      new Set(expenseIds),
    );
    expect(after.groups[0]).toMatchObject({
      id: groupId,
      ownerName: "Ana Ruiz",
      invitationId,
    });
    expect(after.groups[0]?.participants).toEqual([
      expect.objectContaining({ contactId: null, name: "Ana Ruiz" }),
      expect.objectContaining({ name: "Beto Cano", you: true, joined: true }),
      expect.objectContaining({ name: "Martica", joined: false }),
    ]);
    for (const hidden of ["userId", "totals", "status"]) {
      expect(after.groups[0]).not.toHaveProperty(hidden);
    }
    for (const hidden of ["userId"]) {
      expect(after.expenses[0]).not.toHaveProperty(hidden);
    }
  });

  it("refuses a part the owner has not marked paid", async () => {
    const res = await as(
      beto,
      request(app)
        .post(
          `/joined-groups/${groupId}/expenses/${expenseIds[0]}/add-to-ledger`,
        )
        .send({ accountId: betoAccount, categoryId: betoCategory }),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SHARED_LINE_NOT_PAID");
  });

  it("lets a paid line into your ledger once, from two devices at once, and again after deleting it", async () => {
    const anaAccount = await created(
      as(
        ana,
        request(app)
          .post("/accounts")
          .send({ name: "Bancolombia", type: "SAVINGS", balance: 0 }),
      ),
    );
    const paid = await as(
      ana,
      request(app).post("/settlements").send({
        contactId: betoContact,
        date: "2026-09-21T12:00:00.000Z",
        collected: 30000,
        accountId: anaAccount,
      }),
    );
    expect(paid.status).toBe(201);

    const add = (): request.Test =>
      as(
        beto,
        request(app)
          .post(
            `/joined-groups/${groupId}/expenses/${expenseIds[0]}/add-to-ledger`,
          )
          .send({ accountId: betoAccount, categoryId: betoCategory }),
      );
    const [first, second] = await Promise.all([add(), add()]);

    expect([first.status, second.status].sort()).toEqual([201, 400]);
    const mine = first.status === 201 ? first : second;
    const refused = first.status === 201 ? second : first;
    expect(refused.body.code).toBe("SHARED_LINE_IN_LEDGER");
    expect(mine.body).toMatchObject({
      type: "EXPENSE",
      amount: 30000,
      description: "Cabin",
      date: "2026-09-19T15:00:00.000Z",
      importedFromGroupId: groupId,
      importedFromExpenseId: expenseIds[0],
      countsAsYours: 30000,
    });

    const deleted = await as(
      beto,
      request(app).delete(`/transactions/${mine.body.id}`),
    );
    expect(deleted.status).toBe(200);
    expect((await add()).status).toBe(201);
  });

  it("leaves: the owner reads LEFT, and the group is no longer yours to read or add from", async () => {
    const left = await as(
      beto,
      request(app).post(`/invitations/${invitationId}/leave`),
    );
    expect(left.status).toBe(200);
    expect(left.body.status).toBe("LEFT");

    const sent = await as(
      ana,
      request(app).get(`/shared-groups/${groupId}/invitations`),
    );
    expect(sent.body.data[0]).toMatchObject({ status: "LEFT" });
    expect(sent.body.data[0].leftAt).not.toBeNull();

    const listed = await as(beto, request(app).get("/joined-groups"));
    expect(listed.body.data).toHaveLength(0);
    const add = await as(
      beto,
      request(app)
        .post(
          `/joined-groups/${groupId}/expenses/${expenseIds[1]}/add-to-ledger`,
        )
        .send({ accountId: betoAccount, categoryId: betoCategory }),
    );
    expect(add.status).toBe(404);
  });
});
