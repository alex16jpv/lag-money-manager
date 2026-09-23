/**
 * What the mocked suite cannot see about invitations (T-129): the partial
 * unique index that keeps one live invitation per person per group, the
 * invited person's side of the change feed found by address, and the writes
 * other modules make to invitations inside their own transactions.
 */
import request from "supertest";

import app from "../../app";
import { SharedInvitationModel } from "../../infrastructure/models/SharedInvitationModel";
import { connect, disconnect, dropDatabase } from "./support";

interface Session {
  token: string;
  userId: string;
}

async function register(
  email: string,
  name: string,
  currency = "COP",
): Promise<Session> {
  const res = await request(app)
    .post("/auth/register")
    .send({ name, email, password: "Offline!2026", currency });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

async function contact(
  session: Session,
  name: string,
  email?: string,
): Promise<string> {
  const res = await as(
    session,
    request(app)
      .post("/contacts")
      .send({ name, ...(email && { email }) }),
  );
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function group(
  session: Session,
  name: string,
  contactIds: string[],
): Promise<string> {
  const res = await as(
    session,
    request(app).post("/shared-groups").send({ name, contactIds }),
  );
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const invite = (session: Session, groupId: string, contactId: string) =>
  as(
    session,
    request(app)
      .post(`/shared-groups/${groupId}/invitations`)
      .send({ contactId }),
  );

async function feed(session: Session) {
  const res = await as(session, request(app).get("/sync/changes"));
  expect(res.status).toBe(200);
  return res.body.changes as {
    invitationsSent: Record<string, unknown>[];
    invitationsReceived: Record<string, unknown>[];
    contacts: Record<string, unknown>[];
  };
}

describe("invitations against mongod", () => {
  let john: Session;
  let beto: Session;
  let tom: Session;

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    john = await register("john@invitations.test", "John Doe");
    beto = await register("beto@invitations.test", "Beto Cano");
    tom = await register("tom@invitations.test", "Tom Baker", "EUR");
  });

  afterAll(async () => {
    await disconnect();
  });

  it("answers the same to an address with an account and one without", async () => {
    const withAccount = await contact(john, "Beto", "beto@invitations.test");
    const without = await contact(john, "Nadie", "nobody@invitations.test");
    const groupId = await group(john, "Night out", [withAccount, without]);

    const a = await invite(john, groupId, withAccount);
    const b = await invite(john, groupId, without);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    expect(a.body.status).toBe("PENDING");
    expect(b.body.status).toBe("PENDING");
  });

  it("keeps one live invitation per person per group, even when two arrive at once", async () => {
    const ana = await contact(john, "Ana", "ana@invitations.test");
    const groupId = await group(john, "Two at once", [ana]);

    const [first, second] = await Promise.all([
      invite(john, groupId, ana),
      invite(john, groupId, ana),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.id).toBe(second.body.id);
    expect(
      await SharedInvitationModel.countDocuments({ groupId, contactId: ana }),
    ).toBe(1);
  });

  it("brings it down the invited person's feed with only what they may read", async () => {
    const received = (await feed(beto)).invitationsReceived;

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      groupName: "Night out",
      inviterName: "John Doe",
      inviterEmail: "john@invitations.test",
      groupCurrency: "COP",
      status: "PENDING",
    });
    for (const hidden of ["contactId", "email", "userId", "inviteeId"]) {
      expect(received[0]).not.toHaveProperty(hidden);
    }
    expect((await feed(john)).invitationsSent.length).toBeGreaterThan(0);
    expect((await feed(tom)).invitationsReceived).toHaveLength(0);
  });

  it("shows a rename to whoever is still waiting", async () => {
    const [{ groupId }] = (await feed(beto)).invitationsReceived as {
      groupId: string;
    }[];

    const res = await as(
      john,
      request(app)
        .put(`/shared-groups/${groupId}`)
        .send({ name: "Night out in Bogotá" }),
    );

    expect(res.status).toBe(200);
    expect((await feed(beto)).invitationsReceived[0]).toMatchObject({
      groupName: "Night out in Bogotá",
    });
  });

  it("stores who answered only once somebody has: the partial index leaves the rest out", async () => {
    const waiting = await SharedInvitationModel.findOne({
      email: "beto@invitations.test",
    }).lean();

    expect(waiting).not.toHaveProperty("inviteeId");
  });

  it("accepts without writing anything into the inviter's contacts", async () => {
    const [waiting] = (await feed(beto)).invitationsReceived as {
      id: string;
    }[];

    const res = await as(
      beto,
      request(app).post(`/invitations/${waiting.id}/accept`),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACCEPTED");
    const linked = (await feed(john)).contacts.find(
      (c) => c.email === "beto@invitations.test",
    );
    expect(linked).toBeDefined();
    expect(linked).not.toHaveProperty("linkedUserId");
    const sent = (await feed(john)).invitationsSent.find(
      (i) => i.id === waiting.id,
    );
    expect(sent).toMatchObject({ status: "ACCEPTED" });
    expect(sent).not.toHaveProperty("inviteeId");
  });

  it("keeps the answer in the invited person's feed after they change their email", async () => {
    const res = await as(
      beto,
      request(app).put(`/users/${beto.userId}`).send({
        email: "beto.new@invitations.test",
        currentPassword: "Offline!2026",
      }),
    );
    expect(res.status).toBe(200);
    const login = await request(app).post("/auth/login").send({
      email: "beto.new@invitations.test",
      password: "Offline!2026",
    });
    beto = { token: login.body.accessToken, userId: beto.userId };

    const received = (await feed(beto)).invitationsReceived;

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ status: "ACCEPTED" });
  });

  it("never hands somebody else's answers to whoever registers the old address", async () => {
    const newcomer = await register("beto@invitations.test", "Not Beto");

    expect((await feed(newcomer)).invitationsReceived).toHaveLength(0);
  });

  it("refuses a group in another currency, and lets it be declined", async () => {
    const tomContact = await contact(john, "Tom", "tom@invitations.test");
    const groupId = await group(john, "Lisbon", [tomContact]);
    const sent = await invite(john, groupId, tomContact);

    const accept = await as(
      tom,
      request(app).post(`/invitations/${sent.body.id}/accept`),
    );
    const decline = await as(
      tom,
      request(app).post(`/invitations/${sent.body.id}/decline`),
    );

    expect(accept.status).toBe(400);
    expect(accept.body.code).toBe("CURRENCY_MISMATCH");
    expect(decline.status).toBe(200);
    expect(decline.body.status).toBe("DECLINED");
  });

  it("answers somebody else's invitation like a missing one", async () => {
    const [nobody] = await SharedInvitationModel.find({
      email: "nobody@invitations.test",
    }).lean();

    const res = await as(
      tom,
      request(app).post(`/invitations/${nobody?._id}/accept`),
    );

    expect(res.status).toBe(404);
  });

  it("withdraws the waiting ones when the group is archived, in the same write", async () => {
    const lucia = await contact(john, "Lucía", "lucia@invitations.test");
    const groupId = await group(john, "Archived trip", [lucia]);
    const sent = await invite(john, groupId, lucia);

    const res = await as(
      john,
      request(app).delete(`/shared-groups/${groupId}`),
    );

    expect(res.status).toBe(200);
    const stored = await SharedInvitationModel.findById(sent.body.id).lean();
    expect(stored?.status).toBe("WITHDRAWN");
    expect(stored?.open).toBeUndefined();
  });

  it("withdraws a waiting one when the contact's email changes", async () => {
    const diego = await contact(john, "Diego", "diego@invitations.test");
    const groupId = await group(john, "Gift", [diego]);
    const sent = await invite(john, groupId, diego);

    const res = await as(
      john,
      request(app)
        .put(`/contacts/${diego}`)
        .send({ email: "diego.p@invitations.test" }),
    );

    expect(res.status).toBe(200);
    const stored = await SharedInvitationModel.findById(sent.body.id).lean();
    expect(stored?.status).toBe("WITHDRAWN");
    const again = await invite(john, groupId, diego);
    expect(again.status).toBe(201);
    expect(again.body.email).toBe("diego.p@invitations.test");
  });

  it("lets an expired one step aside for a new invitation", async () => {
    const carla = await contact(john, "Carla", "carla@invitations.test");
    const groupId = await group(john, "Expired", [carla]);
    const first = await invite(john, groupId, carla);
    await SharedInvitationModel.updateOne(
      { _id: first.body.id },
      { expiresAt: new Date(Date.now() - 1000) },
    );

    const second = await invite(john, groupId, carla);

    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    const old = await SharedInvitationModel.findById(first.body.id).lean();
    expect(old?.status).toBe("PENDING");
    expect(old?.open).toBeUndefined();
  });

  it("stops sharing with somebody who joined, and they can be invited again", async () => {
    const joined = await SharedInvitationModel.findOne({
      status: "ACCEPTED",
    }).lean();

    const res = await as(
      john,
      request(app).delete(
        `/shared-groups/${joined?.groupId}/invitations/${joined?._id}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("WITHDRAWN");
    const again = await invite(
      john,
      joined?.groupId as string,
      joined?.contactId as string,
    );
    expect(again.status).toBe(201);
  });

  it("finds the invited person's rows through its indexes", async () => {
    const byEmail = (await SharedInvitationModel.find({
      email: "nobody@invitations.test",
    })
      .sort({ updatedAt: 1, _id: 1 })
      .explain("executionStats")) as unknown as {
      executionStats: { totalDocsExamined: number; nReturned: number };
    }[];
    const byInvitee = (await SharedInvitationModel.find({
      inviteeId: tom.userId,
    })
      .sort({ updatedAt: 1, _id: 1 })
      .explain("executionStats")) as unknown as {
      executionStats: { totalDocsExamined: number; nReturned: number };
    }[];

    for (const plan of [byEmail, byInvitee]) {
      const stats = (Array.isArray(plan) ? plan[0] : plan) as {
        executionStats: { totalDocsExamined: number; nReturned: number };
      };
      expect(stats.executionStats.totalDocsExamined).toBe(
        stats.executionStats.nReturned,
      );
    }
  });
});
