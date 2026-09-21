/**
 * Giving up on what somebody owes you (T-117), against mongod: it moves no
 * figure — that money was counted as yours the day it left — it stops being
 * owed, and archiving a group does it for whoever is left owing.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

interface Session {
  token: string;
  userId: string;
}

const ACCOUNT_ID = "019576a0-d7b6-7d6d-af6a-2b7545600001";
const CATEGORY_ID = "019576a0-d7b6-7d6d-af6a-2b7545600002";

describe("writing off, against mongod", () => {
  let session: Session;
  let ana: string;
  let groupId: string;
  let movementId: string;

  const as = (req: request.Test): request.Test =>
    req.set("Authorization", `Bearer ${session.token}`);

  const group = async (): Promise<{ totals: Record<string, number> }> => {
    const res = await as(request(app).get(`/shared-groups/${groupId}`));
    expect(res.status).toBe(200);
    return res.body as { totals: Record<string, number> };
  };

  const countsAsYours = async (): Promise<number> => {
    const res = await as(request(app).get(`/transactions/${movementId}`));
    return res.body.countsAsYours as number;
  };

  const reasons = async (): Promise<string[]> => {
    const res = await as(request(app).get(`/transactions/${movementId}`));
    return (res.body.sharedHistory as { reason: string }[]).map(
      (entry) => entry.reason,
    );
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const registered = await request(app).post("/auth/register").send({
      name: "Owner",
      email: "owner@write-offs.test",
      password: "Offline!2026",
    });
    expect(registered.status).toBe(201);
    session = {
      token: registered.body.accessToken,
      userId: registered.body.user.id,
    };
    await as(
      request(app).post("/accounts").send({
        id: ACCOUNT_ID,
        name: "Bancolombia",
        type: "ACCOUNT",
        balance: 5_000_000,
      }),
    );
    await as(
      request(app)
        .post("/categories")
        .send({ id: CATEGORY_ID, name: "Eating out", type: "EXPENSE" }),
    );
  }, 30_000);

  afterAll(async () => {
    await disconnect();
  });

  beforeEach(async () => {
    const contact = await as(
      request(app)
        .post("/contacts")
        .send({ name: `Ana ${Date.now()}` }),
    );
    expect(contact.status).toBe(201);
    ana = contact.body.id as string;
    const created = await as(
      request(app)
        .post("/shared-groups")
        .send({ name: `Night out ${Date.now()}`, contactIds: [ana] }),
    );
    expect(created.status).toBe(201);
    groupId = created.body.id as string;
    const spent = await as(
      request(app).post("/transactions").send({
        type: "EXPENSE",
        amount: 90_000,
        date: "2026-08-10T18:00:00.000Z",
        description: "Dinner",
        categoryId: CATEGORY_ID,
        fromAccountId: ACCOUNT_ID,
      }),
    );
    movementId = spent.body.id as string;
    expect(
      (
        await as(
          request(app)
            .post(`/shared-groups/${groupId}/expenses`)
            .send({ transactionId: movementId }),
        )
      ).status,
    ).toBe(201);
  });

  it("stops being owed without moving what counts as yours", async () => {
    expect((await group()).totals.owedToYou).toBe(45_000);

    const given = await as(
      request(app)
        .post(`/shared-groups/${groupId}/write-offs`)
        .send({ contactId: ana }),
    );

    expect(given.status).toBe(200);
    expect(given.body.totals.owedToYou).toBe(0);
    expect(given.body.totals.writtenOff).toBe(45_000);
    // The money left the account the day it was spent: nothing to recalculate.
    expect(await countsAsYours()).toBe(90_000);
    expect(await reasons()).toEqual(["SPLIT", "WRITE_OFF"]);
    expect(given.body.status).toBe("SETTLED");
  });

  it("is taken back while the group is open, and says so", async () => {
    await as(
      request(app)
        .post(`/shared-groups/${groupId}/write-offs`)
        .send({ contactId: ana }),
    );

    const back = await as(
      request(app).delete(`/shared-groups/${groupId}/write-offs/${ana}`),
    );

    expect(back.status).toBe(200);
    expect(back.body.totals.owedToYou).toBe(45_000);
    expect(back.body.totals.writtenOff).toBe(0);
    expect(await reasons()).toEqual(["SPLIT", "WRITE_OFF", "WRITE_OFF_UNDONE"]);
  });

  it("leaves what they did pay where it is", async () => {
    await as(
      request(app).post("/settlements").send({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 20_000,
        accountId: ACCOUNT_ID,
      }),
    );

    const given = await as(
      request(app)
        .post(`/shared-groups/${groupId}/write-offs`)
        .send({ contactId: ana }),
    );

    // Only what was still open is given up on; the 20.000 that arrived stay paid.
    expect(given.body.totals.writtenOff).toBe(25_000);
    expect(given.body.totals.collected).toBe(20_000);
    expect(await countsAsYours()).toBe(70_000);
  });

  it("is idempotent, and refuses somebody who is not in the group", async () => {
    const first = await as(
      request(app)
        .post(`/shared-groups/${groupId}/write-offs`)
        .send({ contactId: ana }),
    );
    const again = await as(
      request(app)
        .post(`/shared-groups/${groupId}/write-offs`)
        .send({ contactId: ana }),
    );
    const stranger = await as(
      request(app)
        .post(`/shared-groups/${groupId}/write-offs`)
        .send({ contactId: "019576a0-d7b6-7d6d-af6a-2b75456000ff" }),
    );

    expect(first.body.totals.writtenOff).toBe(45_000);
    expect(again.status).toBe(200);
    expect(again.body.totals.writtenOff).toBe(45_000);
    expect(await reasons()).toEqual(["SPLIT", "WRITE_OFF"]);
    expect(stranger.status).toBe(400);
    expect(stranger.body.code).toBe("PARTICIPANT_NOT_IN_GROUP");
  });

  it("writes off whoever is left owing when the group is archived", async () => {
    const archived = await as(request(app).delete(`/shared-groups/${groupId}`));

    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).not.toBeNull();
    expect(archived.body.totals.writtenOff).toBe(45_000);
    expect(archived.body.totals.owedToYou).toBe(0);
    expect(await countsAsYours()).toBe(90_000);
    expect(await reasons()).toEqual(["SPLIT", "WRITE_OFF"]);
  });

  it("cannot be given or taken back once the group is archived", async () => {
    await as(request(app).delete(`/shared-groups/${groupId}`));

    const given = await as(
      request(app)
        .post(`/shared-groups/${groupId}/write-offs`)
        .send({ contactId: ana }),
    );
    const back = await as(
      request(app).delete(`/shared-groups/${groupId}/write-offs/${ana}`),
    );

    expect(given.status).toBe(400);
    expect(given.body.code).toBe("RESOURCE_ARCHIVED");
    expect(back.status).toBe(400);
  });

  it("gives up on a block of guests like on anybody else", async () => {
    const spent = await as(
      request(app).post("/transactions").send({
        type: "EXPENSE",
        amount: 230_000,
        date: "2026-08-18T18:00:00.000Z",
        description: "Party",
        categoryId: CATEGORY_ID,
        fromAccountId: ACCOUNT_ID,
      }),
    );
    const withGuests = await as(
      request(app)
        .post(`/shared-groups/${groupId}/expenses`)
        .send({
          transactionId: spent.body.id,
          split: {
            mode: "EQUAL",
            guests: { count: 20, name: "The office" },
            shares: [
              { party: "USER" },
              { party: "CONTACT", contactId: ana },
              { party: "GUESTS" },
            ],
          },
        }),
    );
    expect(withGuests.status).toBe(201);

    const given = await as(
      request(app)
        .post(`/shared-groups/${groupId}/write-offs`)
        .send({ expenseId: withGuests.body.id }),
    );

    // 230.000 over 22 parts: the block weighs twenty of them, and the odd peso is the payer's.
    expect(given.status).toBe(200);
    expect(given.body.totals.writtenOff).toBe(209_090);
    expect(given.body.writeOffs[0].kind).toBe("GUESTS");
  });
});
