/**
 * `POST /sync` against a real mongod and over HTTP (O-B4): the three batches
 * the plan names — a replayed one, one with a 409 inside, one with a broken
 * dependency — plus what the mocks cannot see: the operation registry and its
 * TTL index, the body cap, and the money moving exactly once.
 */
import request from "supertest";

import app from "../../app";
import { AccountModel } from "../../infrastructure/models/AccountModel";
import { SyncOpModel } from "../../infrastructure/models/SyncOpModel";
import { SYNC_OP_TTL_SECONDS } from "../../shared/syncBatch";
import { connect, disconnect, dropDatabase } from "./support";

const uuid = (kind: "a" | "b" | "c" | "d" | "e" | "f", n: number): string =>
  `01950000-0000-7000-8000-${kind}${String(n).padStart(11, "0")}`;

interface Session {
  token: string;
  userId: string;
}

interface Operation {
  opId: string;
  seq: number;
  occurredAt: string;
  entity: "account" | "category" | "transaction" | "budget";
  action: string;
  id: string;
  payload?: { body?: Record<string, unknown>; query?: { reference?: string } };
  baseUpdatedAt?: string;
  dependsOn?: string[];
  opVersion: number;
}

interface Result {
  opId: string;
  status: string;
  code?: string;
  message?: string;
  details?: { field: string; message: string }[];
  current?: Record<string, unknown>;
  result?: Record<string, unknown>;
  blockedBy?: string;
}

let opCounter = 0;
let seqCounter = 0;
const op = (
  over: Pick<Operation, "entity" | "action" | "id"> & Partial<Operation>,
): Operation => ({
  opId: uuid("f", ++opCounter),
  seq: ++seqCounter,
  occurredAt: "2026-09-05T10:00:00.000Z",
  opVersion: 1,
  ...over,
});

async function register(email: string): Promise<Session> {
  const res = await request(app).post("/auth/register").send({
    name: "Batch tester",
    email,
    password: "Offline!2026",
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

const push = async (
  session: Session,
  operations: Operation[],
): Promise<Result[]> => {
  const res = await as(
    session,
    request(app).post("/sync").send({ operations }),
  );
  expect(res.status).toBe(200);
  return res.body.results as Result[];
};

const statuses = (results: Result[]): string[] => results.map((r) => r.status);

/** The `updatedAt` an applied result carries; fails the test if it does not. */
const versionOf = (result: Result): string => {
  const updatedAt = result.result?.updatedAt;
  expect(typeof updatedAt).toBe("string");
  return updatedAt as string;
};

const balanceOf = async (id: string): Promise<number | undefined> =>
  (await AccountModel.findById(id).lean())?.balance;

const accountBody = (
  name: string,
  balance: number,
): Record<string, unknown> => ({
  name,
  type: "CASH",
  balance,
});

const expense = (
  fromAccountId: string,
  amount: number,
): Record<string, unknown> => ({
  type: "EXPENSE",
  amount,
  date: "2026-09-01T12:00:00.000Z",
  fromAccountId,
});

describe("POST /sync against mongod", () => {
  let alice: Session;

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    alice = await register("alice@batch.test");
  });

  afterAll(async () => {
    await dropDatabase();
    await disconnect();
  });

  it("keeps the registry under a 30-day TTL index", async () => {
    await SyncOpModel.init();
    const indexes = await SyncOpModel.collection.indexes();
    const ttl = indexes.find((i) => i.key.createdAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(SYNC_OP_TTL_SECONDS);
    expect(SYNC_OP_TTL_SECONDS).toBe(30 * 86_400);
  });

  describe("a replayed batch", () => {
    const accountId = uuid("a", 1);
    const txId = uuid("e", 1);
    const batch: Operation[] = [];

    it("lands a create and a dependent movement, moving the money once", async () => {
      batch.push(
        op({
          entity: "account",
          action: "create",
          id: accountId,
          payload: { body: accountBody("Replay", 1000) },
        }),
        op({
          entity: "transaction",
          action: "create",
          id: txId,
          payload: { body: expense(accountId, 100) },
          dependsOn: [accountId],
        }),
      );

      const results = await push(alice, batch);

      expect(statuses(results)).toEqual(["applied", "applied"]);
      expect(results[0].result).toMatchObject({
        id: accountId,
        name: "Replay",
      });
      expect(results[1].result).toMatchObject({ id: txId, amount: 100 });
      expect(await balanceOf(accountId)).toBe(90_000);
    });

    it("answers the same batch again with `duplicate` and applies nothing", async () => {
      const results = await push(alice, batch);

      expect(statuses(results)).toEqual(["duplicate", "duplicate"]);
      // The registry answered, not the services: no row travels back.
      expect(results[0].result).toBeUndefined();
      expect(await balanceOf(accountId)).toBe(90_000);
      const list = await as(
        alice,
        request(app).get(`/transactions?accountId=${accountId}`),
      );
      expect(list.body.pagination.total).toBe(1);

      const stored = await SyncOpModel.find({ userId: alice.userId })
        .sort({ opId: 1 })
        .lean();
      expect(stored.map((s) => [s.opId, s.status, s.entityId])).toEqual([
        [batch[0].opId, "applied", accountId],
        [batch[1].opId, "applied", txId],
      ]);
    });

    it("answers a landed update with `duplicate` where a bare PUT would 409", async () => {
      const id = uuid("a", 2);
      const [created] = await push(alice, [
        op({
          entity: "account",
          action: "create",
          id,
          payload: { body: accountBody("Guarded update", 5) },
        }),
      ]);
      const version = versionOf(created);
      const update = op({
        entity: "account",
        action: "update",
        id,
        payload: { body: { name: "Renamed once" } },
        baseUpdatedAt: version,
      });

      const first = await push(alice, [update]);
      const again = await push(alice, [update]);
      const bare = await as(
        alice,
        request(app).put(`/accounts/${id}`).send({ name: "Renamed once" }),
      ).set("If-Match", version);

      expect(statuses(first)).toEqual(["applied"]);
      expect(statuses(again)).toEqual(["duplicate"]);
      expect(bare.status).toBe(409);
    });

    it("replays a create whose id the user already owns as `duplicate` with the row", async () => {
      const id = uuid("a", 3);
      await as(
        alice,
        request(app)
          .post("/accounts")
          .send({ id, ...accountBody("Made online", 1) }),
      ).expect(201);

      const [result] = await push(alice, [
        op({
          entity: "account",
          action: "create",
          id,
          payload: { body: accountBody("Made offline too", 99) },
        }),
      ]);

      // Same rule as O-B1: the row wins, and nothing says "mint another id".
      expect(result.status).toBe("duplicate");
      expect(result.result).toMatchObject({ id, name: "Made online" });
    });
  });

  describe("a batch with a 409 inside", () => {
    it("files the stale write as `conflict` with `current`, blocks its row, drains the rest", async () => {
      const id = uuid("a", 4);
      const other = uuid("a", 5);
      const [created] = await push(alice, [
        op({
          entity: "account",
          action: "create",
          id,
          payload: { body: accountBody("Stale", 5) },
        }),
      ]);
      const staleVersion = versionOf(created);

      // Another device gets there first.
      await as(
        alice,
        request(app).put(`/accounts/${id}`).send({ name: "Renamed there" }),
      ).expect(200);

      const stale = op({
        entity: "account",
        action: "update",
        id,
        payload: { body: { name: "Renamed here" } },
        baseUpdatedAt: staleVersion,
      });
      const results = await push(alice, [
        stale,
        op({
          entity: "account",
          action: "archive",
          id,
          baseUpdatedAt: staleVersion,
        }),
        op({
          entity: "account",
          action: "create",
          id: other,
          payload: { body: accountBody("Unrelated", 1) },
        }),
      ]);

      expect(statuses(results)).toEqual(["conflict", "blocked", "applied"]);
      expect(results[0]).toMatchObject({
        code: "STALE_UPDATE",
        current: { id, name: "Renamed there" },
      });
      expect(results[1].blockedBy).toBe(stale.opId);
      expect((await AccountModel.findById(id).lean())?.archivedAt).toBeNull();
      expect(await AccountModel.findById(other).lean()).not.toBeNull();
      // Neither the conflict nor the blocked one is remembered.
      expect(
        await SyncOpModel.countDocuments({
          opId: { $in: [stale.opId, results[1].opId] },
        }),
      ).toBe(0);
    });

    it("files a taken name as `conflict` DUPLICATE, the route's own 409", async () => {
      await push(alice, [
        op({
          entity: "account",
          action: "create",
          id: uuid("a", 10),
          payload: { body: accountBody("Taken name", 1) },
        }),
      ]);
      const [result] = await push(alice, [
        op({
          entity: "account",
          action: "create",
          id: uuid("a", 6),
          payload: { body: accountBody("Taken name", 1) },
        }),
      ]);

      expect(result).toMatchObject({ status: "conflict", code: "DUPLICATE" });
      expect(await AccountModel.findById(uuid("a", 6)).lean()).toBeNull();
    });
  });

  describe("a batch with a broken dependency", () => {
    it("rejects the bad create, blocks what named it, applies the independent op", async () => {
      const accountId = uuid("a", 7);
      const txId = uuid("e", 7);
      const categoryId = uuid("d", 7);
      const bad = op({
        entity: "account",
        action: "create",
        id: accountId,
        payload: { body: { name: "Broken", type: "NOPE", balance: 10.555 } },
      });

      const results = await push(alice, [
        bad,
        op({
          entity: "transaction",
          action: "create",
          id: txId,
          payload: { body: expense(accountId, 10) },
          dependsOn: [accountId],
        }),
        op({
          entity: "category",
          action: "create",
          id: categoryId,
          payload: { body: { name: "Independent", type: "EXPENSE" } },
        }),
      ]);

      expect(statuses(results)).toEqual(["rejected", "blocked", "applied"]);
      expect(results[0].code).toBe("VALIDATION");
      expect((results[0].details ?? []).map((d) => d.field).sort()).toEqual([
        "balance",
        "type",
      ]);
      expect(results[1].blockedBy).toBe(bad.opId);
      expect(results[2].result).toMatchObject({ id: categoryId });
      const tx = await as(alice, request(app).get(`/transactions/${txId}`));
      expect(tx.status).toBe(404);
    });

    it("answers a business rejection with the route's code, and archives on the row keep working", async () => {
      const archivedId = uuid("a", 8);
      const liveId = uuid("a", 9);
      await push(alice, [
        op({
          entity: "account",
          action: "create",
          id: archivedId,
          payload: { body: accountBody("Gone", 300) },
        }),
        op({
          entity: "account",
          action: "create",
          id: liveId,
          payload: { body: accountBody("Here", 300) },
        }),
        op({ entity: "account", action: "archive", id: archivedId }),
      ]);

      const results = await push(alice, [
        op({
          entity: "transaction",
          action: "create",
          id: uuid("e", 8),
          payload: { body: expense(archivedId, 25) },
        }),
        op({
          entity: "transaction",
          action: "quickAdd",
          id: uuid("e", 9),
          payload: { body: { amount: 25, fromAccountId: liveId } },
        }),
      ]);

      // 404 on the route: the same answer as a missing account.
      expect(results[0]).toMatchObject({
        status: "rejected",
        code: "NOT_FOUND",
      });
      expect(results[1]).toMatchObject({
        status: "applied",
        result: { source: "QUICK" },
      });
      expect(await balanceOf(archivedId)).toBe(30_000);
      expect(await balanceOf(liveId)).toBe(27_500);
    });
  });

  describe("budgets and the reference period", () => {
    it("creates, overrides for the referenced period and archives through the batch", async () => {
      const id = uuid("b", 1);
      const reference = "2026-12-15T12:00:00.000Z";
      const results = await push(alice, [
        op({
          entity: "budget",
          action: "create",
          id,
          payload: {
            body: {
              name: "Groceries",
              color: "TEAL",
              categoryIds: [],
              amount: 100,
              periodType: "MONTHLY",
            },
            query: { reference },
          },
        }),
        op({
          entity: "budget",
          action: "setOverride",
          id,
          payload: { body: { amount: 250 }, query: { reference } },
        }),
      ]);

      expect(statuses(results)).toEqual(["applied", "applied"]);
      expect(results[1].result).toMatchObject({
        id,
        periodKey: "2026-12",
        amount: 250,
        baseAmount: 100,
        hasOverride: true,
      });

      const [archived] = await push(alice, [
        op({
          entity: "budget",
          action: "archive",
          id,
          baseUpdatedAt: versionOf(results[1]),
          payload: { query: { reference } },
        }),
      ]);
      expect(archived.status).toBe("applied");
      expect(archived.result?.archivedAt).toEqual(expect.any(String));
    });
  });

  describe("limits", () => {
    it("takes 200 operations in one body and refuses 201", async () => {
      const many = (n: number): Operation[] =>
        Array.from({ length: n }, (_, i) =>
          op({ entity: "account", action: "archive", id: uuid("c", i) }),
        );
      const full = await as(
        alice,
        request(app)
          .post("/sync")
          .send({ operations: many(200) }),
      );
      const over = await as(
        alice,
        request(app)
          .post("/sync")
          .send({ operations: many(201) }),
      );

      expect(full.status).toBe(200);
      expect(full.body.results).toHaveLength(200);
      // Rows that do not exist: each one rejected on its own, none blocked.
      expect(new Set(statuses(full.body.results))).toEqual(
        new Set(["rejected"]),
      );
      expect(over.status).toBe(400);
      expect(over.body.code).toBe("VALIDATION");
    });
  });
});
