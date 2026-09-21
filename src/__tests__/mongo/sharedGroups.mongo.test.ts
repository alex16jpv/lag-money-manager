/**
 * What the mocked suite cannot see about shared groups (T-114): the unique
 * name index, the keyset over `(date, _id)` that orders a group's expenses,
 * the aggregation behind a group's totals and its range, and the transaction
 * that adds people and splits every expense again or neither.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

interface Session {
  token: string;
  userId: string;
}

async function register(email: string): Promise<Session> {
  const res = await request(app)
    .post("/auth/register")
    .send({ name: "Owner", email, password: "Offline!2026" });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

describe("shared groups against mongod", () => {
  let alice: Session;
  let bob: Session;
  let ana: string;
  let beto: string;

  const newContact = async (
    session: Session,
    name: string,
  ): Promise<string> => {
    const res = await as(
      session,
      request(app).post("/contacts").send({ name }),
    );
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  const newGroup = async (
    body: Record<string, unknown>,
  ): Promise<request.Response> =>
    as(alice, request(app).post("/shared-groups").send(body));

  const addExpense = async (
    groupId: string,
    body: Record<string, unknown>,
  ): Promise<request.Response> =>
    as(
      alice,
      request(app).post(`/shared-groups/${groupId}/expenses`).send(body),
    );

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    alice = await register("alice@shared.test");
    bob = await register("bob@shared.test");
    ana = await newContact(alice, "Ana");
    beto = await newContact(alice, "Beto");
  });

  afterAll(async () => {
    await disconnect();
  });

  describe("the group itself", () => {
    it("refuses a second active group with the same name, folding case", async () => {
      expect((await newGroup({ name: "Night out" })).status).toBe(201);

      const again = await newGroup({ name: "NIGHT OUT" });

      expect(again.status).toBe(409);
      expect(again.body.code).toBe("DUPLICATE");
    });

    it("refuses a contact that belongs to another user", async () => {
      const foreign = await newContact(bob, "Ana");

      const res = await newGroup({
        name: "Not mine",
        contactIds: [foreign],
      });

      expect(res.status).toBe(404);
    });

    it("answers 404 for another user's group", async () => {
      const mine = await newGroup({ name: "Private" });

      const res = await as(
        bob,
        request(app).get(`/shared-groups/${mine.body.id}`),
      );

      expect(res.status).toBe(404);
    });
  });

  describe("a group that runs over two months", () => {
    let groupId: string;

    beforeAll(async () => {
      const created = await newGroup({
        name: "Cartagena trip",
        contactIds: [ana, beto],
      });
      expect(created.status).toBe(201);
      groupId = created.body.id as string;

      for (const [description, date, amount] of [
        ["Flights", "2026-08-02T12:00:00.000Z", 900000],
        ["Hotel", "2026-08-20T12:00:00.000Z", 600000],
        ["Dinner", "2026-09-04T12:00:00.000Z", 100000],
      ] as [string, string, number][]) {
        const res = await addExpense(groupId, { description, date, amount });
        expect(res.status).toBe(201);
      }
    });

    it("derives its range and its totals from the expenses it has", async () => {
      const res = await as(
        alice,
        request(app).get(`/shared-groups/${groupId}`),
      );

      expect(res.status).toBe(200);
      expect(res.body.totals.amount).toBe(1600000);
      expect(res.body.totals.expenseCount).toBe(3);
      expect(res.body.totals.dateFrom).toBe("2026-08-02T12:00:00.000Z");
      expect(res.body.totals.dateTo).toBe("2026-09-04T12:00:00.000Z");
      // 300000 + 200000 + 33334: the odd peso of the dinner is the payer's.
      expect(res.body.totals.yourShare).toBe(533334);
    });

    it("lists the expenses newest first and walks them through the cursor", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: request.Response = await as(
          alice,
          request(app).get(
            `/shared-groups/${groupId}/expenses?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
          ),
        );
        expect(res.status).toBe(200);
        seen.push(
          ...res.body.data.map((e: { description: string }) => e.description),
        );
        cursor = res.body.pagination.nextCursor;
      } while (cursor);

      expect(seen).toEqual(["Dinner", "Hotel", "Flights"]);
      expect(new Set(seen).size).toBe(3);
    });

    it("refuses a cursor that names no expense of the caller's", async () => {
      const res = await as(
        alice,
        request(app).get(
          `/shared-groups/${groupId}/expenses?cursor=019576a0-d7b6-7d6d-af6a-000000000000`,
        ),
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CURSOR");
    });

    it("counts a deleted expense in nothing", async () => {
      const extra = await addExpense(groupId, {
        description: "Taxi",
        date: "2026-09-05T12:00:00.000Z",
        amount: 30000,
      });
      const before = await as(
        alice,
        request(app).get(`/shared-groups/${groupId}`),
      );

      const removed = await as(
        alice,
        request(app).delete(
          `/shared-groups/${groupId}/expenses/${extra.body.id}`,
        ),
      );
      expect(removed.status).toBe(200);
      expect(removed.body.deletedAt).not.toBeNull();

      const after = await as(
        alice,
        request(app).get(`/shared-groups/${groupId}`),
      );
      expect(before.body.totals.amount).toBe(1630000);
      expect(after.body.totals.amount).toBe(1600000);
    });
  });

  describe("adding somebody once the group is going", () => {
    let groupId: string;
    let carla: string;

    beforeAll(async () => {
      carla = await newContact(alice, "Carla");
      const created = await newGroup({
        name: "Sunday lunch",
        contactIds: [ana],
      });
      groupId = created.body.id as string;
      expect(
        (
          await addExpense(groupId, {
            description: "Lunch",
            date: "2026-09-10T12:00:00.000Z",
            amount: 90000,
          })
        ).status,
      ).toBe(201);
    });

    it("shows the whole result without writing any of it", async () => {
      const preview = await as(
        alice,
        request(app)
          .post(`/shared-groups/${groupId}/participants/preview`)
          .send({ contactIds: [carla], applyToExistingExpenses: true }),
      );

      expect(preview.status).toBe(200);
      expect(preview.body.expenses).toEqual({
        total: 1,
        resplit: 1,
        untouched: 0,
      });

      const group = await as(
        alice,
        request(app).get(`/shared-groups/${groupId}`),
      );
      expect(group.body.participants).toHaveLength(2);
      expect(group.body.totals.yourShare).toBe(45000);
    });

    it("moves the group and every expense together", async () => {
      const applied = await as(
        alice,
        request(app)
          .post(`/shared-groups/${groupId}/participants`)
          .send({ contactIds: [carla], applyToExistingExpenses: true }),
      );

      expect(applied.status).toBe(200);
      expect(applied.body.group.participants).toHaveLength(3);
      expect(applied.body.applied.expenses.resplit).toBe(1);

      const group = await as(
        alice,
        request(app).get(`/shared-groups/${groupId}`),
      );
      expect(group.body.totals.yourShare).toBe(30000);
    });

    it("refuses to take out somebody who now holds a share", async () => {
      const res = await as(
        alice,
        request(app).delete(`/shared-groups/${groupId}/participants/${carla}`),
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PARTICIPANT_IN_USE");
    });
  });

  describe("archiving", () => {
    it("frees the name and refuses a restore that would take it back", async () => {
      const first = await newGroup({ name: "Reusable" });
      const id = first.body.id as string;
      expect(
        (await as(alice, request(app).delete(`/shared-groups/${id}`))).status,
      ).toBe(200);
      expect((await newGroup({ name: "Reusable" })).status).toBe(201);

      const restored = await as(
        alice,
        request(app).post(`/shared-groups/${id}/restore`).send({}),
      );

      expect(restored.status).toBe(409);
      expect(restored.body.code).toBe("DUPLICATE");
    });

    it("refuses a new expense in an archived group", async () => {
      const created = await newGroup({ name: "Closed" });
      const id = created.body.id as string;
      await as(alice, request(app).delete(`/shared-groups/${id}`));

      const res = await addExpense(id, {
        description: "Late",
        date: "2026-09-01T12:00:00.000Z",
        amount: 1000,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RESOURCE_ARCHIVED");
    });
  });
});
