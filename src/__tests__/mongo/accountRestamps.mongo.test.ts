/**
 * Every movement moves its account's balance, and with it the account's
 * updatedAt (T-146): the write names the account with the stamp it had and the
 * one mongod holds now, so an archive or a new default queued behind it on the
 * same phone lands instead of ending in a conflict with yourself.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

interface Restamp {
  entity: string;
  id: string;
  previousUpdatedAt: string;
  updatedAt: string;
}

const MAIN = "019576a0-d7b6-7d6d-af6a-2b7546600001";
const CATEGORY_ID = "019576a0-d7b6-7d6d-af6a-2b7546600002";

let idCounter = 0;
const nextId = (): string =>
  `019576a0-d7b6-7d6d-af6a-2b7546${String(++idCounter).padStart(6, "0")}`;

let opCounter = 0;
const op = (over: Record<string, unknown>): Record<string, unknown> => ({
  opId: `019576a0-d7b6-7d6d-af6a-2b75466f${String(++opCounter).padStart(4, "0")}`,
  seq: opCounter,
  occurredAt: "2026-09-05T10:00:00.000Z",
  opVersion: 1,
  ...over,
});

describe("what a movement did to its account's stamp, against mongod", () => {
  let token: string;

  const as = (req: request.Test): request.Test =>
    req.set("Authorization", `Bearer ${token}`);

  const stampOf = async (accountId: string): Promise<string> => {
    const res = await as(request(app).get(`/accounts/${accountId}`));
    expect(res.status).toBe(200);
    return res.body.updatedAt as string;
  };

  const openAccount = async (
    over: Record<string, unknown> = {},
  ): Promise<string> => {
    const id = nextId();
    const res = await as(
      request(app)
        .post("/accounts")
        .send({
          id,
          name: `Pocket ${id.slice(-4)}`,
          type: "ACCOUNT",
          balance: 100_000,
          ...over,
        }),
    );
    expect(res.status).toBe(201);
    return id;
  };

  const expense = (
    accountId: string,
    amount = 10_000,
  ): Record<string, unknown> => ({
    type: "EXPENSE",
    amount,
    date: "2026-09-01T12:00:00.000Z",
    categoryId: CATEGORY_ID,
    fromAccountId: accountId,
  });

  // Each restamp is an account, from the stamp the phone held to the one mongod holds now.
  const expectAccounts = async (
    restamped: Restamp[],
    before: Record<string, string>,
  ): Promise<void> => {
    expect(restamped.map((one) => one.id).sort()).toEqual(
      Object.keys(before).sort(),
    );
    for (const one of restamped) {
      expect(one.entity).toBe("account");
      expect(one.previousUpdatedAt).toBe(before[one.id]);
      expect(one.updatedAt).not.toBe(one.previousUpdatedAt);
      expect(await stampOf(one.id)).toBe(one.updatedAt);
    }
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const registered = await request(app).post("/auth/register").send({
      name: "Owner",
      email: "owner@account-restamps.test",
      password: "Offline!2026",
    });
    expect(registered.status).toBe(201);
    token = registered.body.accessToken as string;
    expect(
      (
        await as(
          request(app).post("/accounts").send({
            id: MAIN,
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
            .send({ id: CATEGORY_ID, name: "Groceries", type: "EXPENSE" }),
        )
      ).status,
    ).toBe(201);
  }, 30_000);

  afterAll(async () => {
    await disconnect();
  });

  it("creating a movement names the account it moved", async () => {
    const account = await openAccount();
    const before = { [account]: await stampOf(account) };

    const res = await as(
      request(app).post("/transactions").send(expense(account)),
    );

    expect(res.status).toBe(201);
    await expectAccounts(res.body.restamped, before);
  });

  it("the archive queued behind it lands on the stamp the answer gave, and not on the old one", async () => {
    const account = await openAccount();
    const guardOnPhone = await stampOf(account);
    const created = await as(
      request(app).post("/transactions").send(expense(account)),
    );
    const [moved] = created.body.restamped as Restamp[];
    expect(moved.previousUpdatedAt).toBe(guardOnPhone);

    const stale = await as(
      request(app).delete(`/accounts/${account}`).set("If-Match", guardOnPhone),
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_UPDATE");

    const rebased = await as(
      request(app)
        .delete(`/accounts/${account}`)
        .set("If-Match", moved.updatedAt),
    );
    expect(rebased.status).toBe(200);
  });

  it("a batch runs the archive and the new default behind a movement against the stamp it gave", async () => {
    const archived = await openAccount();
    const promoted = await openAccount();
    const archiveGuard = await stampOf(archived);
    const defaultGuard = await stampOf(promoted);

    const res = await as(
      request(app)
        .post("/sync")
        .send({
          operations: [
            op({
              entity: "transaction",
              action: "create",
              id: nextId(),
              payload: { body: expense(archived) },
            }),
            op({
              entity: "transaction",
              action: "create",
              id: nextId(),
              payload: { body: expense(promoted) },
            }),
            op({
              entity: "account",
              action: "archive",
              id: archived,
              baseUpdatedAt: archiveGuard,
            }),
            op({
              entity: "account",
              action: "setDefault",
              id: promoted,
              baseUpdatedAt: defaultGuard,
            }),
          ],
        }),
    );

    expect(res.status).toBe(200);
    expect(
      res.body.results.map((one: { status: string }) => one.status),
    ).toEqual(["applied", "applied", "applied", "applied"]);
    const [first, second] = res.body.results;
    expect(first.result.restamped).toBeUndefined();
    expect(first.restamped.map((one: Restamp) => one.id)).toEqual([archived]);
    expect(second.restamped.map((one: Restamp) => one.id)).toEqual([promoted]);
    const account = await as(request(app).get(`/accounts/${promoted}`));
    expect(account.body.isDefault).toBe(true);

    // Leave the main account as the default the rest of the suite expects.
    const back = await as(request(app).post(`/accounts/${MAIN}/default`));
    expect(back.status).toBe(200);
  });

  it("a transfer names both accounts, and an edit that moves no money names none", async () => {
    const from = await openAccount();
    const to = await openAccount();
    const before = { [from]: await stampOf(from), [to]: await stampOf(to) };

    const created = await as(
      request(app).post("/transactions").send({
        type: "TRANSFER",
        amount: 20_000,
        date: "2026-09-01T12:00:00.000Z",
        fromAccountId: from,
        toAccountId: to,
      }),
    );
    expect(created.status).toBe(201);
    await expectAccounts(created.body.restamped, before);

    const renamed = await as(
      request(app)
        .put(`/transactions/${created.body.id}`)
        .send({ description: "Savings" }),
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.restamped).toEqual([]);
  });

  it("moving a movement to another account names the one it left and the one it reached", async () => {
    const left = await openAccount();
    const reached = await openAccount();
    const created = await as(
      request(app).post("/transactions").send(expense(left)),
    );
    const before = {
      [left]: await stampOf(left),
      [reached]: await stampOf(reached),
    };

    const res = await as(
      request(app)
        .put(`/transactions/${created.body.id}`)
        .send({ fromAccountId: reached }),
    );

    expect(res.status).toBe(200);
    await expectAccounts(res.body.restamped, before);
  });

  it("deleting a movement of an archived account names it, so the restore behind it lands", async () => {
    const account = await openAccount();
    const created = await as(
      request(app).post("/transactions").send(expense(account)),
    );
    expect((await as(request(app).delete(`/accounts/${account}`))).status).toBe(
      200,
    );
    const before = { [account]: await stampOf(account) };

    const deleted = await as(
      request(app).delete(`/transactions/${created.body.id}`),
    );

    expect(deleted.status).toBe(200);
    await expectAccounts(deleted.body.restamped, before);
    const restored = await as(
      request(app)
        .post(`/accounts/${account}/restore`)
        .set("If-Match", deleted.body.restamped[0].updatedAt)
        .send({}),
    );
    expect(restored.status).toBe(200);
  });

  it("a quick capture names the default account it fell on", async () => {
    const before = { [MAIN]: await stampOf(MAIN) };

    const res = await as(
      request(app)
        .post("/transactions/quick")
        .send({ amount: 5_000, date: "2026-09-01T12:00:00.000Z" }),
    );

    expect(res.status).toBe(201);
    await expectAccounts(res.body.restamped, before);
  });

  it("a replayed create names nothing: it moved no balance this time", async () => {
    const account = await openAccount();
    const body = { id: nextId(), ...expense(account) };
    const first = await as(request(app).post("/transactions").send(body));
    expect(first.status).toBe(201);

    const replay = await as(request(app).post("/transactions").send(body));

    expect(replay.status).toBe(200);
    expect(replay.body.restamped).toEqual([]);
  });

  it("a new default names the account it took the default from", async () => {
    const promoted = await openAccount();
    const before = { [MAIN]: await stampOf(MAIN) };

    const res = await as(request(app).post(`/accounts/${promoted}/default`));

    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
    await expectAccounts(res.body.restamped, before);
    const again = await as(request(app).post(`/accounts/${promoted}/default`));
    expect(again.body.restamped).toEqual([]);
    expect(
      (await as(request(app).post(`/accounts/${MAIN}/default`))).status,
    ).toBe(200);
  });

  it("archiving the account a new default was taken from lands on the stamp that write gave it", async () => {
    const demoted = await openAccount();
    const promoted = await openAccount();
    expect(
      (await as(request(app).post(`/accounts/${demoted}/default`))).status,
    ).toBe(200);
    const demotedGuard = await stampOf(demoted);

    const res = await as(
      request(app)
        .post("/sync")
        .send({
          operations: [
            op({
              entity: "account",
              action: "setDefault",
              id: promoted,
              baseUpdatedAt: await stampOf(promoted),
            }),
            op({
              entity: "account",
              action: "archive",
              id: demoted,
              baseUpdatedAt: demotedGuard,
            }),
          ],
        }),
    );

    expect(res.status).toBe(200);
    expect(
      res.body.results.map((one: { status: string }) => one.status),
    ).toEqual(["applied", "applied"]);
    expect(res.body.results[0].restamped.map((one: Restamp) => one.id)).toEqual(
      [demoted],
    );
    expect(
      (await as(request(app).post(`/accounts/${MAIN}/default`))).status,
    ).toBe(200);
  });

  it("a payment from a contact names the account it landed on", async () => {
    const contact = await as(
      request(app).post("/contacts").send({ name: "Ana" }),
    );
    expect(contact.status).toBe(201);
    const account = await openAccount();
    const before = { [account]: await stampOf(account) };

    const res = await as(
      request(app).post("/settlements").send({
        contactId: contact.body.id,
        date: "2026-09-01T12:00:00.000Z",
        collected: 30_000,
        accountId: account,
      }),
    );

    expect(res.status).toBe(201);
    await expectAccounts(res.body.restamped, before);
  });
});
