/**
 * The two optional debt amounts against a real mongod and over HTTP (T-87).
 *
 * Mocks cannot see any of this: the decimal the API speaks is stored as integer
 * cents, clearing a field has to survive the round trip, and the change feed the
 * offline mirror reads is a second serialization of the same row.
 */
import request from "supertest";

import app from "../../app";
import { AccountModel } from "../../infrastructure/models/AccountModel";
import { connect, disconnect, dropDatabase } from "./support";

const uuid = (n: number): string =>
  `01950000-0000-7000-8000-a${String(n).padStart(11, "0")}`;

interface Session {
  token: string;
  userId: string;
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

describe("account debt fields", () => {
  let owner: Session;

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const res = await request(app).post("/auth/register").send({
      name: "Debt tester",
      email: "debt@accounts.test",
      password: "Offline!2026",
      currency: "USD",
    });
    expect(res.status).toBe(201);
    owner = { token: res.body.accessToken, userId: res.body.user.id };
  });

  afterAll(disconnect);

  it("stores a credit limit as integer cents and answers it as a decimal", async () => {
    const id = uuid(1);
    const created = await as(
      owner,
      request(app).post("/accounts").send({
        id,
        name: "Visa Gold",
        type: "CARD",
        balance: -1245.9,
        creditLimit: 4000,
      }),
    );

    expect(created.status).toBe(201);
    expect(created.body.creditLimit).toBe(4000);
    expect((await AccountModel.findById(id).lean())?.creditLimit).toBe(400000);
  });

  it("carries the limit into the change feed the offline mirror reads", async () => {
    const changes = await as(owner, request(app).get("/sync/changes"));

    expect(changes.status).toBe(200);
    const card = changes.body.changes.accounts.find(
      (a: { id: string }) => a.id === uuid(1),
    );
    expect(card.creditLimit).toBe(4000);
  });

  it("clears the limit with null, and the account stops carrying the field", async () => {
    const cleared = await as(
      owner,
      request(app)
        .put(`/accounts/${uuid(1)}`)
        .send({ creditLimit: null }),
    );

    expect(cleared.status).toBe(200);
    expect(cleared.body).not.toHaveProperty("creditLimit");
  });

  it("takes the cleared field out of the document, instead of leaving a null in it", async () => {
    const stored = await AccountModel.findById(uuid(1)).lean();

    expect(stored).not.toBeNull();
    expect(stored).not.toHaveProperty("creditLimit");
  });

  it("writes nothing when a type without the field is told to clear it", async () => {
    const id = uuid(5);
    await as(
      owner,
      request(app)
        .post("/accounts")
        .send({ id, name: "Wallet", type: "CASH", balance: 50 }),
    );

    const cleared = await as(
      owner,
      request(app).put(`/accounts/${id}`).send({ creditLimit: null }),
    );

    expect(cleared.status).toBe(200);
    expect(await AccountModel.findById(id).lean()).not.toHaveProperty(
      "creditLimit",
    );
  });

  it("refuses a credit limit on a type that has no such field", async () => {
    const res = await as(
      owner,
      request(app)
        .post("/accounts")
        .send({
          id: uuid(2),
          name: "Wallet",
          type: "CASH",
          creditLimit: 4000,
        }),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ACCOUNT_FIELD_NOT_FOR_TYPE");
    expect(await AccountModel.findById(uuid(2)).lean()).toBeNull();
  });

  it("refuses a type change that would orphan the stored amount, and takes it with the clear", async () => {
    const id = uuid(3);
    const created = await as(
      owner,
      request(app).post("/accounts").send({
        id,
        name: "Car loan",
        type: "LOAN",
        balance: -12000,
        borrowedAmount: 15000,
      }),
    );
    expect(created.status).toBe(201);

    const orphaned = await as(
      owner,
      request(app).put(`/accounts/${id}`).send({ type: "ACCOUNT" }),
    );
    expect(orphaned.status).toBe(400);
    expect(orphaned.body.code).toBe("ACCOUNT_FIELD_NOT_FOR_TYPE");

    const withClear = await as(
      owner,
      request(app)
        .put(`/accounts/${id}`)
        .send({ type: "ACCOUNT", borrowedAmount: null }),
    );
    expect(withClear.status).toBe(200);
    expect(withClear.body.type).toBe("ACCOUNT");
    expect(withClear.body).not.toHaveProperty("borrowedAmount");
  });

  it("keeps the amount through archive and restore", async () => {
    const id = uuid(6);
    await as(
      owner,
      request(app).post("/accounts").send({
        id,
        name: "Student loan",
        type: "LOAN",
        balance: -8000,
        borrowedAmount: 9000,
      }),
    );

    await as(owner, request(app).delete(`/accounts/${id}`));
    const restored = await as(
      owner,
      request(app).post(`/accounts/${id}/restore`),
    );

    expect(restored.status).toBe(200);
    expect(restored.body.borrowedAmount).toBe(9000);
  });

  it("carries the fields through POST /sync, guard included", async () => {
    const created = await as(
      owner,
      request(app)
        .post("/sync")
        .send({
          operations: [
            {
              opId: "01950000-0000-7000-8000-b00000000001",
              seq: 1,
              opVersion: 1,
              occurredAt: new Date().toISOString(),
              entity: "account",
              action: "create",
              id: uuid(7),
              payload: {
                body: {
                  id: uuid(7),
                  name: "Amex",
                  type: "CARD",
                  balance: -300,
                  creditLimit: 9000,
                },
              },
            },
          ],
        }),
    );

    expect(created.status).toBe(200);
    expect(created.body.results[0].status).toBe("applied");
    expect(created.body.results[0].result.creditLimit).toBe(9000);

    const orphaned = await as(
      owner,
      request(app)
        .post("/sync")
        .send({
          operations: [
            {
              opId: "01950000-0000-7000-8000-b00000000002",
              seq: 2,
              opVersion: 1,
              occurredAt: new Date().toISOString(),
              entity: "account",
              action: "update",
              id: uuid(7),
              payload: { body: { type: "CASH" } },
            },
          ],
        }),
    );

    expect(orphaned.body.results[0].status).toBe("rejected");
    expect(orphaned.body.results[0].code).toBe("ACCOUNT_FIELD_NOT_FOR_TYPE");
  });

  it("leaves an account of another type untouched by the new fields", async () => {
    const id = uuid(4);
    const created = await as(
      owner,
      request(app)
        .post("/accounts")
        .send({ id, name: "Bancolombia", type: "ACCOUNT", balance: 1000 }),
    );

    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("creditLimit");
    expect(created.body).not.toHaveProperty("borrowedAmount");
  });
});
