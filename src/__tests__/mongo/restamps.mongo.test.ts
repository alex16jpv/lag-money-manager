/**
 * The rows a write rewrites besides the one it answers (T-145): each one comes
 * back with the stamp it had and the one it has now, those stamps are the
 * ones mongod really holds, and a batch runs a later write on such a row
 * against the stamp the earlier one gave it.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

interface Session {
  token: string;
  userId: string;
}

interface Restamp {
  entity: "sharedExpense" | "transaction";
  id: string;
  previousUpdatedAt: string;
  updatedAt: string;
}

interface Share {
  party: string;
  contactId: string | null;
  amount: number;
  collected: number;
}

const ACCOUNT_ID = "019576a0-d7b6-7d6d-af6a-2b7545600001";
const CATEGORY_ID = "019576a0-d7b6-7d6d-af6a-2b7545600002";

let opCounter = 0;
const op = (over: Record<string, unknown>): Record<string, unknown> => ({
  opId: `019576a0-d7b6-7d6d-af6a-2b75456f${String(++opCounter).padStart(4, "0")}`,
  seq: opCounter,
  occurredAt: "2026-09-05T10:00:00.000Z",
  opVersion: 1,
  ...over,
});

describe("what a write rewrote besides its own row, against mongod", () => {
  let session: Session;
  let ana: string;
  let groupId: string;

  const as = (req: request.Test): request.Test =>
    req.set("Authorization", `Bearer ${session.token}`);

  const spent = async (amount: number, date: string): Promise<string> => {
    const created = await as(
      request(app).post("/transactions").send({
        type: "EXPENSE",
        amount,
        date,
        categoryId: CATEGORY_ID,
        fromAccountId: ACCOUNT_ID,
      }),
    );
    expect(created.status).toBe(201);
    return created.body.id as string;
  };

  const split = async (transactionId: string): Promise<string> => {
    const created = await as(
      request(app)
        .post(`/shared-groups/${groupId}/expenses`)
        .send({ transactionId }),
    );
    expect(created.status).toBe(201);
    return created.body.id as string;
  };

  const expense = async (id: string): Promise<Record<string, unknown>> => {
    const res = await as(
      request(app).get(`/shared-groups/${groupId}/expenses/${id}`),
    );
    expect(res.status).toBe(200);
    return res.body as Record<string, unknown>;
  };

  const movement = async (id: string): Promise<Record<string, unknown>> => {
    const res = await as(request(app).get(`/transactions/${id}`));
    expect(res.status).toBe(200);
    return res.body as Record<string, unknown>;
  };

  const stampOf = async (restamp: Restamp): Promise<string> =>
    (restamp.entity === "sharedExpense"
      ? await expense(restamp.id)
      : await movement(restamp.id)
    ).updatedAt as string;

  // What each row is stamped now, keyed like the answer names them.
  const stamps = async (
    expenses: string[],
    movements: string[],
  ): Promise<Map<string, string>> => {
    const now = new Map<string, string>();
    for (const id of expenses) {
      now.set(`sharedExpense:${id}`, (await expense(id)).updatedAt as string);
    }
    for (const id of movements) {
      now.set(`transaction:${id}`, (await movement(id)).updatedAt as string);
    }
    return now;
  };

  // Every restamp names the stamp the row had before and the one mongod holds now.
  const expectTrue = async (
    restamped: Restamp[],
    before: Map<string, string>,
  ): Promise<void> => {
    for (const restamp of restamped) {
      expect(restamp.previousUpdatedAt).toBe(
        before.get(`${restamp.entity}:${restamp.id}`),
      );
      expect(restamp.updatedAt).not.toBe(restamp.previousUpdatedAt);
      expect(await stampOf(restamp)).toBe(restamp.updatedAt);
    }
  };

  const named = (restamped: Restamp[]): string[] =>
    restamped.map((one) => `${one.entity}:${one.id}`).sort();

  const halves = (): Record<string, unknown> => ({
    mode: "EQUAL",
    shares: [{ party: "USER" }, { party: "CONTACT", contactId: ana }],
  });

  const settle = async (
    body: Record<string, unknown>,
  ): Promise<request.Response> =>
    as(request(app).post("/settlements").send(body));

  const clear = async (): Promise<void> => {
    const settlements = await as(request(app).get("/settlements?limit=100"));
    for (const one of settlements.body.data ?? []) {
      await as(request(app).delete(`/settlements/${one.id}`));
    }
    const expenses = await as(
      request(app).get(`/shared-groups/${groupId}/expenses?limit=100`),
    );
    for (const one of expenses.body.data ?? []) {
      await as(
        request(app).delete(`/shared-groups/${groupId}/expenses/${one.id}`),
      );
    }
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const registered = await request(app).post("/auth/register").send({
      name: "Owner",
      email: "owner@restamps.test",
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
    expect(
      (
        await as(
          request(app)
            .post("/categories")
            .send({ id: CATEGORY_ID, name: "Eating out", type: "EXPENSE" }),
        )
      ).status,
    ).toBe(201);
    const contact = await as(
      request(app).post("/contacts").send({ name: "Ana" }),
    );
    expect(contact.status).toBe(201);
    ana = contact.body.id as string;
    const group = await as(
      request(app)
        .post("/shared-groups")
        .send({ name: "Night out", contactIds: [ana] }),
    );
    expect(group.status).toBe(201);
    groupId = group.body.id as string;
  }, 30_000);

  afterAll(async () => {
    await disconnect();
  });

  // Two lines of yours split half with Ana, and 50 000 of hers covering the older one first.
  describe("with a payment imputed over two lines", () => {
    let older: string;
    let newer: string;
    let olderExpense: string;
    let newerExpense: string;

    beforeEach(async () => {
      await clear();
      older = await spent(90_000, "2026-08-10T18:00:00.000Z");
      newer = await spent(60_000, "2026-08-20T18:00:00.000Z");
      olderExpense = await split(older);
      newerExpense = await split(newer);
      expect(
        (
          await settle({
            contactId: ana,
            date: "2026-08-25T18:00:00.000Z",
            collected: 50_000,
            accountId: ACCOUNT_ID,
          })
        ).status,
      ).toBe(201);
    });

    it("a new amount on the movement names its expense and the line the payment moved onto", async () => {
      const before = await stamps([olderExpense, newerExpense], [older, newer]);

      const res = await as(
        request(app).put(`/transactions/${older}`).send({ amount: 70_000 }),
      );

      expect(res.status).toBe(200);
      // Ana's share of the older line fell to 35 000, so 15 000 of her payment moved onto the newer.
      expect(named(res.body.restamped)).toEqual(
        [
          `sharedExpense:${olderExpense}`,
          `sharedExpense:${newerExpense}`,
          `transaction:${newer}`,
        ].sort(),
      );
      await expectTrue(res.body.restamped, before);
      // The row it answers carries its own stamp, which is the one mongod holds.
      expect(res.body.updatedAt).toBe((await movement(older)).updatedAt);
    });

    it("the split queued behind it lands on the stamp the answer gave, and not on the old one", async () => {
      const guardOnPhone = (await expense(olderExpense)).updatedAt as string;
      const res = await as(
        request(app).put(`/transactions/${older}`).send({ amount: 70_000 }),
      );
      const moved = (res.body.restamped as Restamp[]).find(
        (one) => one.id === olderExpense,
      ) as Restamp;
      expect(moved.previousUpdatedAt).toBe(guardOnPhone);

      const stale = await as(
        request(app)
          .put(`/shared-groups/${groupId}/expenses/${olderExpense}`)
          .set("If-Match", guardOnPhone)
          .send({ split: halves() }),
      );
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe("STALE_UPDATE");

      const rebased = await as(
        request(app)
          .put(`/shared-groups/${groupId}/expenses/${olderExpense}`)
          .set("If-Match", moved.updatedAt)
          .send({ split: halves() }),
      );
      expect(rebased.status).toBe(200);
    });

    it("a batch runs the split behind the amount against the stamp the amount gave the expense", async () => {
      const guardOnPhone = (await expense(olderExpense)).updatedAt as string;
      const movementStamp = (await movement(older)).updatedAt as string;

      const res = await as(
        request(app)
          .post("/sync")
          .send({
            operations: [
              op({
                entity: "transaction",
                action: "update",
                id: older,
                baseUpdatedAt: movementStamp,
                payload: { body: { amount: 70_000 } },
              }),
              op({
                entity: "sharedExpense",
                action: "update",
                id: olderExpense,
                baseUpdatedAt: guardOnPhone,
                payload: {
                  body: { split: halves() },
                  params: { groupId },
                },
              }),
            ],
          }),
      );

      expect(res.status).toBe(200);
      const [amount, resplit] = res.body.results;
      expect(amount.status).toBe("applied");
      expect(resplit.status).toBe("applied");
      // Lifted out of the row, so the row is the route's row and nothing else.
      expect(amount.result.restamped).toBeUndefined();
      expect(named(amount.restamped)).toContain(
        `sharedExpense:${olderExpense}`,
      );
      const shares = (await expense(olderExpense)).split as { shares: Share[] };
      expect(shares.shares.map((share) => share.amount)).toEqual([
        35_000, 35_000,
      ]);
    });

    it("a batch resent after only the amount landed still runs the split on the stamp it gave", async () => {
      const guardOnPhone = (await expense(olderExpense)).updatedAt as string;
      const amount = op({
        entity: "transaction",
        action: "update",
        id: older,
        baseUpdatedAt: (await movement(older)).updatedAt,
        payload: { body: { amount: 70_000 } },
      });
      const first = await as(
        request(app)
          .post("/sync")
          .send({ operations: [amount] }),
      );
      expect(first.body.results[0].status).toBe("applied");

      const resent = await as(
        request(app)
          .post("/sync")
          .send({
            operations: [
              amount,
              op({
                entity: "sharedExpense",
                action: "update",
                id: olderExpense,
                baseUpdatedAt: guardOnPhone,
                payload: { body: { split: halves() }, params: { groupId } },
              }),
            ],
          }),
      );

      const [again, resplit] = resent.body.results;
      expect(again.status).toBe("duplicate");
      expect(again.restamped).toEqual(first.body.results[0].restamped);
      expect(resplit.status).toBe("applied");
    });

    it("a batch moves a guard only from the stamp the earlier write moved it from", async () => {
      const movementStamp = (await movement(older)).updatedAt as string;

      const res = await as(
        request(app)
          .post("/sync")
          .send({
            operations: [
              op({
                entity: "transaction",
                action: "update",
                id: older,
                baseUpdatedAt: movementStamp,
                payload: { body: { amount: 70_000 } },
              }),
              op({
                entity: "sharedExpense",
                action: "update",
                id: olderExpense,
                baseUpdatedAt: "2026-01-01T00:00:00.000Z",
                payload: {
                  body: { split: halves() },
                  params: { groupId },
                },
              }),
            ],
          }),
      );

      expect(res.status).toBe(200);
      expect(res.body.results[0].status).toBe("applied");
      expect(res.body.results[1].status).toBe("conflict");
      expect(res.body.results[1].code).toBe("STALE_UPDATE");
    });

    it("deleting the movement names the line the payment moved onto, and answers no row in a batch", async () => {
      const before = await stamps([newerExpense], [newer]);

      const res = await as(
        request(app)
          .post("/sync")
          .send({
            operations: [
              op({ entity: "transaction", action: "delete", id: older }),
            ],
          }),
      );

      expect(res.status).toBe(200);
      const [deleted] = res.body.results;
      expect(deleted.status).toBe("applied");
      expect(deleted.result).toBeUndefined();
      expect(named(deleted.restamped)).toEqual(
        [`sharedExpense:${newerExpense}`, `transaction:${newer}`].sort(),
      );
      await expectTrue(deleted.restamped, before);
    });

    it("undoing the payment names every line and movement it had covered", async () => {
      const before = await stamps([olderExpense, newerExpense], [older, newer]);
      const [payment] = (await as(request(app).get("/settlements?limit=10")))
        .body.data;

      const res = await as(request(app).delete(`/settlements/${payment.id}`));

      expect(res.status).toBe(200);
      expect(named(res.body.restamped)).toEqual(
        [
          `sharedExpense:${olderExpense}`,
          `sharedExpense:${newerExpense}`,
          `transaction:${older}`,
          `transaction:${newer}`,
        ].sort(),
      );
      await expectTrue(res.body.restamped, before);
    });

    it("saving a split answers the expense as the imputation left it", async () => {
      const res = await as(
        request(app)
          .put(`/shared-groups/${groupId}/expenses/${olderExpense}`)
          .send({
            split: {
              mode: "EXACT",
              shares: [
                { party: "USER", fixedAmount: 60_000 },
                { party: "CONTACT", contactId: ana, fixedAmount: 30_000 },
              ],
            },
          }),
      );

      expect(res.status).toBe(200);
      const stored = await expense(olderExpense);
      expect(res.body.updatedAt).toBe(stored.updatedAt);
      expect(res.body.split).toEqual(stored.split);
      // Ana's line fell to 30 000, so the other 20 000 of her payment moved onto the newer one.
      expect(named(res.body.restamped)).toContain(
        `sharedExpense:${newerExpense}`,
      );
    });
  });

  describe("writing off what Ana owes", () => {
    let mine: string;

    beforeEach(async () => {
      await clear();
      mine = await spent(40_000, "2026-08-10T18:00:00.000Z");
      await split(mine);
    });

    afterEach(async () => {
      await as(
        request(app).delete(`/shared-groups/${groupId}/write-offs/${ana}`),
      );
    });

    it("names the movement whose history says so, and undoing it does too", async () => {
      const before = await stamps([], [mine]);

      const given = await as(
        request(app)
          .post(`/shared-groups/${groupId}/write-offs`)
          .send({ contactId: ana }),
      );

      expect(given.status).toBe(200);
      expect(named(given.body.restamped)).toEqual([`transaction:${mine}`]);
      await expectTrue(given.body.restamped, before);

      const again = await stamps([], [mine]);
      const undone = await as(
        request(app).delete(`/shared-groups/${groupId}/write-offs/${ana}`),
      );
      expect(undone.status).toBe(200);
      expect(named(undone.body.restamped)).toEqual([`transaction:${mine}`]);
      await expectTrue(undone.body.restamped, again);
    });
  });

  describe("adding somebody to the group's existing lines", () => {
    it("names every line it re-split and every movement it stamped", async () => {
      await clear();
      const mine = await spent(30_000, "2026-08-10T18:00:00.000Z");
      const line = await split(mine);
      const carla = await as(
        request(app).post("/contacts").send({ name: "Carla" }),
      );
      expect(carla.status).toBe(201);
      const before = await stamps([line], [mine]);

      const res = await as(
        request(app)
          .post(`/shared-groups/${groupId}/participants`)
          .send({ contactIds: [carla.body.id], applyToExistingExpenses: true }),
      );

      expect(res.status).toBe(200);
      expect(named(res.body.restamped)).toEqual(
        [`sharedExpense:${line}`, `transaction:${mine}`].sort(),
      );
      await expectTrue(res.body.restamped, before);
      await clear();
      const out = await as(
        request(app).delete(
          `/shared-groups/${groupId}/participants/${carla.body.id}`,
        ),
      );
      expect(out.status).toBe(200);
    });
  });
});
