/**
 * Two writes with the same person at the same moment (T-155, T-135). Each one
 * imputes that person's payments over their lines inside its own transaction;
 * unless both write something in common, neither sees the other and the
 * figures come out as if only one had happened.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

const ACCOUNT_ID = "019576a0-d7b6-7d6d-af6a-2b7545510001";
const OTHER_ACCOUNT_ID = "019576a0-d7b6-7d6d-af6a-2b7545510002";
const CATEGORY_ID = "019576a0-d7b6-7d6d-af6a-2b7545510003";
const ROUNDS = 5;

describe("two writes with the same person at once, against mongod", () => {
  let token: string;

  const as = (req: request.Test): request.Test =>
    req.set("Authorization", `Bearer ${token}`);

  const created = async (
    path: string,
    body: Record<string, unknown>,
  ): Promise<string> => {
    const res = await as(request(app).post(path).send(body));
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  const spent = (amount: number, date: string): Promise<string> =>
    created("/transactions", {
      type: "EXPENSE",
      amount,
      date,
      categoryId: CATEGORY_ID,
      fromAccountId: ACCOUNT_ID,
    });

  const countsAsYours = async (id: string): Promise<number> => {
    const res = await as(request(app).get(`/transactions/${id}`));
    expect(res.status).toBe(200);
    return res.body.countsAsYours as number;
  };

  const withSomeone = async (
    round: number,
  ): Promise<{ contactId: string; groupId: string }> => {
    const contactId = await created("/contacts", { name: `Ana ${round}` });
    const groupId = await created("/shared-groups", {
      name: `Night out ${round}`,
      contactIds: [contactId],
    });
    return { contactId, groupId };
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const registered = await request(app).post("/auth/register").send({
      name: "Owner",
      email: "owner@concurrency.test",
      password: "Offline!2026",
    });
    expect(registered.status).toBe(201);
    token = registered.body.accessToken;
    for (const [id, name] of [
      [ACCOUNT_ID, "Bancolombia"],
      [OTHER_ACCOUNT_ID, "Nequi"],
    ]) {
      await created("/accounts", {
        id,
        name,
        type: "ACCOUNT",
        balance: 10_000_000,
      });
    }
    await created("/categories", {
      id: CATEGORY_ID,
      name: "Eating out",
      type: "EXPENSE",
    });
  }, 30_000);

  afterAll(async () => {
    await disconnect();
  });

  it("imputes a payment over a line added in the same instant", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { contactId, groupId } = await withSomeone(round);
      const first = await spent(60_000, "2026-08-10T18:00:00.000Z");
      await created(`/shared-groups/${groupId}/expenses`, {
        transactionId: first,
      });
      const second = await spent(80_000, "2026-08-20T18:00:00.000Z");

      const [payment, line] = await Promise.all([
        as(
          request(app).post("/settlements").send({
            contactId,
            date: "2026-08-25T18:00:00.000Z",
            collected: 50_000,
            accountId: ACCOUNT_ID,
          }),
        ),
        as(
          request(app)
            .post(`/shared-groups/${groupId}/expenses`)
            .send({ transactionId: second }),
        ),
      ]);
      expect([payment.status, line.status]).toEqual([201, 201]);

      // 30.000 of the 50.000 close the first line; the other 20.000 belong to the second.
      expect(await countsAsYours(first)).toBe(30_000);
      expect(await countsAsYours(second)).toBe(60_000);
    }
  });

  it("imputes a payment over the first line anybody gives that person, added in the same instant", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { contactId, groupId } = await withSomeone(round + 2 * ROUNDS);
      const first = await spent(60_000, "2026-08-10T18:00:00.000Z");

      const [payment, line] = await Promise.all([
        as(
          request(app).post("/settlements").send({
            contactId,
            date: "2026-08-25T18:00:00.000Z",
            collected: 50_000,
            accountId: ACCOUNT_ID,
          }),
        ),
        as(
          request(app)
            .post(`/shared-groups/${groupId}/expenses`)
            .send({ transactionId: first }),
        ),
      ]);
      expect([payment.status, line.status]).toEqual([201, 201]);

      // Nobody had written for this person yet, so both writes create the same claim.
      expect(await countsAsYours(first)).toBe(30_000);
    }
  });

  it("gives back what they paid ahead only once", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { contactId } = await withSomeone(round + ROUNDS);
      await created("/settlements", {
        contactId,
        date: "2026-08-25T18:00:00.000Z",
        collected: 100_000,
        accountId: ACCOUNT_ID,
      });

      const refunds = await Promise.all(
        [ACCOUNT_ID, OTHER_ACCOUNT_ID].map((accountId) =>
          as(
            request(app).post("/settlements").send({
              contactId,
              date: "2026-08-26T18:00:00.000Z",
              paid: 100_000,
              accountId,
            }),
          ),
        ),
      );

      expect(refunds.map((res) => res.status).sort()).toEqual([201, 400]);
      expect(refunds.find((res) => res.status === 400)?.body.code).toBe(
        "SETTLEMENT_OVER_PAID",
      );
    }
  });
});
