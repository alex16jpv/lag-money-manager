/**
 * The eight write paths an offline client actually walks, against a real
 * mongod and over HTTP (O-B6, from the mandatory list in the plan's §O-B6).
 *
 * They were each verified by hand when their feature landed (O-B1..O-B3) with
 * throwaway scripts; this is where they become regressions somebody else can
 * run. Mocks are no use for any of them: the replay rules hang off unique
 * indexes and a Mongo transaction rolling back, the batch case needs real
 * concurrency, and the clock case needs a server that stamps its own time.
 *
 * Nothing here changes behaviour — O-B6 adds tests, not routes.
 */
import request from "supertest";

import app from "../../app";
import { AccountModel } from "../../infrastructure/models/AccountModel";
import { connect, disconnect, dropDatabase } from "./support";

/** The kind is a hex digit: everything after the last dash must still parse as a UUID. */
const uuid = (kind: "a" | "b" | "c" | "d" | "e", n: number): string =>
  `01940000-0000-7000-8000-${kind}${String(n).padStart(11, "0")}`;

interface Session {
  token: string;
  userId: string;
}

async function register(email: string): Promise<Session> {
  const res = await request(app).post("/auth/register").send({
    name: "Offline tester",
    email,
    password: "Offline!2026",
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const as = (
  session: Session,
  req: request.Test,
  ifMatch?: string,
): request.Test => {
  const withAuth = req.set("Authorization", `Bearer ${session.token}`);
  return ifMatch === undefined ? withAuth : withAuth.set("If-Match", ifMatch);
};

const createAccount = (
  session: Session,
  id: string,
  name: string,
  balance: number,
): request.Test =>
  as(
    session,
    request(app).post("/accounts").send({ id, name, type: "ACCOUNT", balance }),
  );

const balanceOf = async (id: string): Promise<number | undefined> =>
  (await AccountModel.findById(id).lean())?.balance;

describe("offline write paths", () => {
  let alice: Session;
  let bob: Session;

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    alice = await register("alice@offline.test");
    bob = await register("bob@offline.test");
  });

  afterAll(async () => {
    await dropDatabase();
    await disconnect();
  });

  it("replays an identical create without writing twice", async () => {
    const accountId = uuid("a", 1);
    const transactionId = uuid("e", 1);
    await createAccount(alice, accountId, "Replay exact", 1000).expect(201);

    const body = {
      id: transactionId,
      type: "EXPENSE",
      amount: 100,
      date: "2026-08-01T12:00:00.000Z",
      fromAccountId: accountId,
    };
    const first = await as(
      alice,
      request(app).post("/transactions").send(body),
    );
    const replay = await as(
      alice,
      request(app).post("/transactions").send(body),
    );

    expect(first.status).toBe(201);
    // 200, not 201: the row the client already has, not a second one.
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.createdAt).toBe(first.body.createdAt);
    // The balance moved once. This is the property the whole outbox rests on.
    expect(await balanceOf(accountId)).toBe(90_000);

    const list = await as(
      alice,
      request(app).get(`/transactions?accountId=${accountId}`),
    );
    expect(list.body.data).toHaveLength(1);
  });

  it("finishes a batch that only half landed", async () => {
    const accountId = uuid("a", 2);
    await createAccount(alice, accountId, "Half replay", 1000).expect(201);

    const batch = [1, 2, 3, 4, 5].map((n) => ({
      id: uuid("b", n),
      type: "EXPENSE",
      amount: 10,
      date: "2026-08-02T12:00:00.000Z",
      fromAccountId: accountId,
    }));

    // The connection drops after three: the device never learns they landed.
    for (const item of batch.slice(0, 3)) {
      await as(alice, request(app).post("/transactions").send(item)).expect(
        201,
      );
    }
    // On reconnect the outbox resends the whole batch, in order.
    const statuses: number[] = [];
    for (const item of batch) {
      const res = await as(
        alice,
        request(app).post("/transactions").send(item),
      );
      statuses.push(res.status);
    }

    expect(statuses).toEqual([200, 200, 200, 201, 201]);
    expect(await balanceOf(accountId)).toBe(95_000);
    const list = await as(
      alice,
      request(app).get(`/transactions?accountId=${accountId}`),
    );
    expect(list.body.pagination.total).toBe(5);
  });

  it("refuses another user's id opaquely and leaves the row alone", async () => {
    const accountId = uuid("a", 3);
    await createAccount(alice, accountId, "Alice's account", 500).expect(201);

    const foreign = await createAccount(bob, accountId, "Bob's account", 999);
    const ownConflict = await createAccount(
      alice,
      accountId,
      "Renamed by Alice",
      999,
    );

    expect(foreign.status).toBe(409);
    expect(foreign.body.code).toBe("ID_TAKEN");
    // Same code and same words as a collision with one of your own rows: the
    // answer must not tell Bob whether that id exists or is someone else's.
    expect(foreign.body.message).toBe(ownConflict.body.message);
    expect(ownConflict.status).toBe(409);

    const stored = await AccountModel.findById(accountId).lean();
    expect([stored?.name, stored?.userId]).toEqual([
      "Alice's account",
      alice.userId,
    ]);
  });

  it("rejects a stale If-Match and hands back the server's copy", async () => {
    const accountId = uuid("a", 4);
    await createAccount(alice, accountId, "Guarded", 100).expect(201);
    const read = await as(alice, request(app).get(`/accounts/${accountId}`));
    const staleVersion = read.body.updatedAt;

    // Another device gets there first.
    await as(
      alice,
      request(app)
        .put(`/accounts/${accountId}`)
        .send({ name: "Renamed there" }),
      staleVersion,
    ).expect(200);

    const late = await as(
      alice,
      request(app).put(`/accounts/${accountId}`).send({ name: "Renamed here" }),
      staleVersion,
    );

    expect(late.status).toBe(409);
    expect(late.body.code).toBe("STALE_UPDATE");
    // `current` is what makes the conflict resolvable without a second call.
    expect(late.body.current.name).toBe("Renamed there");
    expect((await AccountModel.findById(accountId).lean())?.name).toBe(
      "Renamed there",
    );
  });

  it("drains ten guarded writes when one of them conflicts", async () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => uuid("c", n));
    const versions: string[] = [];
    for (const [i, id] of ids.entries()) {
      await createAccount(alice, id, `Batch ${i}`, 10).expect(201);
      const read = await as(alice, request(app).get(`/accounts/${id}`));
      versions.push(read.body.updatedAt);
    }

    // The device goes offline. Meanwhile another one renames the fourth.
    const conflicted = 3;
    await as(
      alice,
      request(app)
        .put(`/accounts/${ids[conflicted]}`)
        .send({ name: "Touched elsewhere" }),
    ).expect(200);

    // The outbox drains, each write carrying the version it read before.
    const statuses: number[] = [];
    for (const [i, id] of ids.entries()) {
      const res = await as(
        alice,
        request(app)
          .put(`/accounts/${id}`)
          .send({ name: `Drained ${i}` }),
        versions[i],
      );
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 200)).toHaveLength(9);
    expect(statuses[conflicted]).toBe(409);
    // The nine that did not conflict are through: one conflict blocks its own
    // row, never the queue.
    for (const [i, id] of ids.entries()) {
      const stored = await AccountModel.findById(id).lean();
      expect(stored?.name).toBe(
        i === conflicted ? "Touched elsewhere" : `Drained ${i}`,
      );
    }
  });

  it("refuses a movement whose account was archived elsewhere", async () => {
    const archivedId = uuid("a", 5);
    const liveId = uuid("a", 6);
    await createAccount(alice, archivedId, "Archived there", 300).expect(201);
    await createAccount(alice, liveId, "Still here", 300).expect(201);

    await as(alice, request(app).delete(`/accounts/${archivedId}`)).expect(200);

    const queued = await as(
      alice,
      request(app)
        .post("/transactions")
        .send({
          id: uuid("e", 5),
          type: "EXPENSE",
          amount: 25,
          date: "2026-08-03T12:00:00.000Z",
          fromAccountId: archivedId,
        }),
    );

    // 404, the same answer as a deleted account: for the outbox both mean
    // "that account is gone here", and the row needs a new destination.
    expect(queued.status).toBe(404);
    expect(await balanceOf(archivedId)).toBe(30_000);
    expect(await balanceOf(liveId)).toBe(30_000);
    const list = await as(
      alice,
      request(app).get(`/transactions?accountId=${archivedId}`),
    );
    expect(list.body.data).toHaveLength(0);
  });

  it("refuses a movement filed under a category archived online", async () => {
    const accountId = uuid("a", 7);
    const archivedCategory = uuid("d", 1);
    const liveCategory = uuid("d", 2);
    await createAccount(alice, accountId, "Categories", 500).expect(201);
    for (const [id, name] of [
      [archivedCategory, "Retired category"],
      [liveCategory, "Live category"],
    ]) {
      await as(
        alice,
        request(app)
          .post("/categories")
          .send({ id, name, type: "EXPENSE", color: "GRAY" }),
      ).expect(201);
    }
    await as(
      alice,
      request(app).delete(`/categories/${archivedCategory}`),
    ).expect(200);

    const movement = {
      type: "EXPENSE",
      amount: 40,
      date: "2026-08-04T12:00:00.000Z",
      fromAccountId: accountId,
    };
    const refused = await as(
      alice,
      request(app)
        .post("/transactions")
        .send({ ...movement, id: uuid("e", 7), categoryId: archivedCategory }),
    );
    const accepted = await as(
      alice,
      request(app)
        .post("/transactions")
        .send({ ...movement, id: uuid("e", 8), categoryId: liveCategory }),
    );

    expect([refused.status, refused.body.code]).toEqual([
      400,
      "CATEGORY_ARCHIVED",
    ]);
    expect(accepted.status).toBe(201);
    // Only the accepted one moved money.
    expect(await balanceOf(accountId)).toBe(46_000);
  });

  describe("a device whose clock runs ahead", () => {
    it("loses nothing when it pulls with the stored cursor instead of its clock", async () => {
      const accountId = uuid("a", 8);
      await createAccount(alice, accountId, "Clock", 10).expect(201);

      const ahead = new Date(Date.now() + 10 * 60_000).toISOString();
      const withDeviceClock = await as(
        alice,
        request(app).get(`/sync/changes?since=${encodeURIComponent(ahead)}`),
      );
      // Everything this user owns is older than the device's idea of "now",
      // so a `since` taken from the device clock hides all of it.
      expect(withDeviceClock.status).toBe(200);
      expect(withDeviceClock.body.pagination.count).toBe(0);

      const drain = await as(
        alice,
        request(app).get("/sync/changes?limit=1000"),
      );
      expect(drain.body.pagination.hasMore).toBe(false);
      expect(drain.body.pagination.count).toBeGreaterThan(0);

      // The cursor of a finished run sits 60 s behind the server's clock, so
      // the same rows arrive again: the client upserts by id and pays nothing.
      const again = await as(
        alice,
        request(app).get(
          `/sync/changes?cursor=${encodeURIComponent(drain.body.pagination.nextCursor)}&limit=1000`,
        ),
      );
      const ids = (body: {
        changes: { accounts: { id: string }[] };
      }): string[] => body.changes.accounts.map((a) => a.id);
      expect(ids(again.body)).toContain(accountId);
    });

    it("refuses a movement dated beyond the tolerated drift", async () => {
      const accountId = uuid("a", 9);
      await createAccount(alice, accountId, "Fast clock", 100).expect(201);
      const movement = {
        type: "EXPENSE",
        amount: 5,
        fromAccountId: accountId,
      };

      const tomorrow = await as(
        alice,
        request(app)
          .post("/transactions")
          .send({
            ...movement,
            id: uuid("e", 9),
            date: new Date(Date.now() + 48 * 3_600_000).toISOString(),
          }),
      );
      const slightlyAhead = await as(
        alice,
        request(app)
          .post("/transactions")
          .send({
            ...movement,
            id: uuid("e", 10),
            date: new Date(Date.now() + 3_600_000).toISOString(),
          }),
      );

      // A queue minted on a fast clock can carry dates the server rejects:
      // the outbox has to surface these, not retry them forever.
      expect([tomorrow.status, tomorrow.body.code]).toEqual([
        400,
        "FUTURE_DATE",
      ]);
      expect(slightlyAhead.status).toBe(201);
    });
  });
});
