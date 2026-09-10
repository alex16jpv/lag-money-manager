/**
 * `POST /sync` against a real mongod and over HTTP (O-B4): the three batches
 * the plan names — a replayed one, one with a 409 inside, one with a broken
 * dependency — plus what the mocks cannot see: the operation registry and its
 * TTL index, the body cap, and the money moving exactly once.
 */
import request from "supertest";

import app from "../../app";
import { AccountModel } from "../../infrastructure/models/AccountModel";
import { BudgetModel } from "../../infrastructure/models/BudgetModel";
import { CategoryModel } from "../../infrastructure/models/CategoryModel";
import { SyncOpModel } from "../../infrastructure/models/SyncOpModel";
import { TransactionModel } from "../../infrastructure/models/TransactionModel";
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
  mergedInto?: string;
  warnings?: string[];
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

  // T-09: the write and its registry row are two commits, so a crash between
  // them leaves the operation on the server with nothing remembering it. The
  // resend then met the guard its own write had already moved.
  describe("a replay whose registry row was lost", () => {
    const lose = async (opId: string): Promise<void> => {
      const { deletedCount } = await SyncOpModel.deleteMany({ opId });
      expect(deletedCount).toBe(1);
    };

    const statusOf = async (opId: string): Promise<string | undefined> =>
      (await SyncOpModel.findById(`${alice.userId}:${opId}`).lean())?.status;

    it("answers a guarded movement update that already landed with `duplicate`", async () => {
      const accountId = uuid("a", 20);
      const txId = uuid("e", 20);
      await push(alice, [
        op({
          entity: "account",
          action: "create",
          id: accountId,
          payload: { body: accountBody("Lost record", 1000) },
        }),
      ]);
      const [movement] = await push(alice, [
        op({
          entity: "transaction",
          action: "create",
          id: txId,
          payload: { body: expense(accountId, 100) },
        }),
      ]);
      const update = op({
        entity: "transaction",
        action: "update",
        id: txId,
        payload: { body: { amount: 300 } },
        baseUpdatedAt: versionOf(movement),
      });

      expect(statuses(await push(alice, [update]))).toEqual(["applied"]);
      expect(await balanceOf(accountId)).toBe(70_000);

      await lose(update.opId);
      const again = await push(alice, [update]);

      expect(statuses(again)).toEqual(["duplicate"]);
      expect(again[0].code).toBeUndefined();
      // The money moved once, and the operation is back on record so the next
      // resend is answered from the registry again.
      expect(await balanceOf(accountId)).toBe(70_000);
      expect(await statusOf(update.opId)).toBe("duplicate");
    });

    it("answers a guarded archive that already landed with `duplicate`", async () => {
      const id = uuid("a", 21);
      const [created] = await push(alice, [
        op({
          entity: "account",
          action: "create",
          id,
          payload: { body: accountBody("Archived once", 5) },
        }),
      ]);
      const archive = op({
        entity: "account",
        action: "archive",
        id,
        baseUpdatedAt: versionOf(created),
      });

      expect(statuses(await push(alice, [archive]))).toEqual(["applied"]);
      await lose(archive.opId);

      expect(statuses(await push(alice, [archive]))).toEqual(["duplicate"]);
      expect(
        (await AccountModel.findById(id).lean())?.archivedAt,
      ).not.toBeNull();
    });

    it("lands the same change another device already made, instead of asking", async () => {
      const id = uuid("a", 22);
      const [created] = await push(alice, [
        op({
          entity: "account",
          action: "create",
          id,
          payload: { body: accountBody("Same edit", 5) },
        }),
      ]);
      const mine = op({
        entity: "account",
        action: "update",
        id,
        payload: { body: { name: "Groceries" } },
        baseUpdatedAt: versionOf(created),
      });
      await as(
        alice,
        request(app).put(`/accounts/${id}`).send({ name: "Groceries" }),
      ).expect(200);

      expect(statuses(await push(alice, [mine]))).toEqual(["duplicate"]);
    });

    it("keeps the conflict when the server holds something else", async () => {
      const id = uuid("a", 23);
      const [created] = await push(alice, [
        op({
          entity: "account",
          action: "create",
          id,
          payload: { body: accountBody("Other edit", 5) },
        }),
      ]);
      const mine = op({
        entity: "account",
        action: "update",
        id,
        payload: { body: { name: "Mine" } },
        baseUpdatedAt: versionOf(created),
      });
      await as(
        alice,
        request(app).put(`/accounts/${id}`).send({ name: "Theirs" }),
      ).expect(200);

      const results = await push(alice, [mine]);

      expect(statuses(results)).toEqual(["conflict"]);
      expect(results[0].code).toBe("STALE_UPDATE");
      expect(results[0].current).toMatchObject({ id, name: "Theirs" });
      expect(await statusOf(mine.opId)).toBeUndefined();
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

    it("names the account archived online, and the live one keeps working", async () => {
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

      // The route answers a bare 404; the batch looks the row up and says
      // WHY, because only "archived online" is the user's to resolve (§5.3).
      expect(results[0]).toMatchObject({
        status: "conflict",
        code: "RESOURCE_ARCHIVED",
        current: { id: archivedId, name: "Gone" },
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
  describe("reconciliation rules per entity", () => {
    const accountId = uuid("a", 11);

    beforeAll(async () => {
      await push(alice, [
        op({
          entity: "account",
          action: "create",
          id: accountId,
          payload: { body: accountBody("Reconcile", 1000) },
        }),
      ]);
    });

    it("merges an offline category into the server's and redirects the batch", async () => {
      const serverCat = uuid("d", 1);
      const localCat = uuid("d", 2);
      const txId = uuid("e", 2);
      const budgetId = uuid("b", 2);
      // Created online, in a different casing than the device used.
      await as(
        alice,
        request(app)
          .post("/categories")
          .send({ id: serverCat, name: "Comida", type: "EXPENSE" }),
      ).expect(201);

      const batch = [
        op({
          entity: "category",
          action: "create",
          id: localCat,
          payload: { body: { name: "comida", type: "EXPENSE" } },
        }),
        op({
          entity: "transaction",
          action: "create",
          id: txId,
          payload: {
            body: { ...expense(accountId, 40), categoryId: localCat },
          },
          dependsOn: [localCat, accountId],
        }),
        op({
          entity: "budget",
          action: "create",
          id: budgetId,
          payload: {
            body: {
              name: "Food",
              color: "TEAL",
              categoryIds: [localCat],
              amount: 100,
              periodType: "MONTHLY",
            },
          },
          dependsOn: [localCat],
        }),
      ];
      const results = await push(alice, batch);

      expect(statuses(results)).toEqual(["merged", "applied", "applied"]);
      expect(results[0]).toMatchObject({
        id: localCat,
        mergedInto: serverCat,
        result: { id: serverCat, name: "Comida" },
      });
      // Nothing was created under the id the device minted...
      expect(await CategoryModel.findById(localCat).lean()).toBeNull();
      // ...and everything that named it landed on the server's row.
      expect((await TransactionModel.findById(txId).lean())?.categoryId).toBe(
        serverCat,
      );
      expect(
        (await BudgetModel.findById(budgetId).lean())?.categoryIds,
      ).toEqual([serverCat]);
      expect(
        (await SyncOpModel.findById(`${alice.userId}:${batch[0].opId}`).lean())
          ?.entityId,
      ).toBe(serverCat);

      // The response was lost: the resend still learns where it landed.
      const resent = await push(alice, batch);
      expect(resent[0]).toMatchObject({
        status: "duplicate",
        mergedInto: serverCat,
      });
    });

    it("keeps a name held by a category of another type a conflict", async () => {
      const serverCat = uuid("d", 3);
      await as(
        alice,
        request(app)
          .post("/categories")
          .send({ id: serverCat, name: "Salario", type: "INCOME" }),
      ).expect(201);

      const [result] = await push(alice, [
        op({
          entity: "category",
          action: "create",
          id: uuid("d", 4),
          payload: { body: { name: "salario", type: "EXPENSE" } },
        }),
      ]);

      expect(result).toMatchObject({
        status: "conflict",
        code: "DUPLICATE",
        current: { id: serverCat, type: "INCOME" },
      });
      expect(result.mergedInto).toBeUndefined();
      expect(await CategoryModel.findById(uuid("d", 4)).lean()).toBeNull();
    });

    it("never merges an account: the taken name comes back with the server's row", async () => {
      const serverAcc = uuid("a", 12);
      await push(alice, [
        op({
          entity: "account",
          action: "create",
          id: serverAcc,
          payload: { body: accountBody("Nequi", 700) },
        }),
      ]);

      const [result] = await push(alice, [
        op({
          entity: "account",
          action: "create",
          id: uuid("a", 13),
          payload: { body: accountBody("nequi", 250) },
        }),
      ]);

      expect(result).toMatchObject({
        status: "conflict",
        code: "DUPLICATE",
        current: { id: serverAcc, name: "Nequi", balance: 700 },
      });
      expect(result.mergedInto).toBeUndefined();
      // The offline balance is not folded into anything: no money moved.
      expect(await balanceOf(serverAcc)).toBe(70_000);
      expect(await AccountModel.findById(uuid("a", 13)).lean()).toBeNull();
    });

    it("restoring an account whose name another took answers the row that holds it", async () => {
      const archivedId = uuid("a", 40);
      const liveId = uuid("a", 41);
      await push(alice, [
        op({
          entity: "account",
          action: "create",
          id: archivedId,
          payload: { body: accountBody("Ahorros", 100) },
        }),
        op({ entity: "account", action: "archive", id: archivedId }),
        op({
          entity: "account",
          action: "create",
          id: liveId,
          payload: { body: accountBody("ahorros", 40) },
        }),
      ]);

      const [restore] = await push(alice, [
        op({ entity: "account", action: "restore", id: archivedId }),
      ]);

      expect(restore).toMatchObject({
        status: "conflict",
        code: "DUPLICATE",
        current: { id: liveId, name: "ahorros" },
      });
      expect(restore.mergedInto).toBeUndefined();
      // Nothing moved: the archived one stays archived, the live one untouched.
      expect(
        (await AccountModel.findById(archivedId).lean())?.archivedAt,
      ).not.toBeNull();
      expect(await balanceOf(liveId)).toBe(4_000);
    });

    it("saves a movement whose category was archived online, flagged for review", async () => {
      const cat = uuid("d", 5);
      const txId = uuid("e", 3);
      await as(
        alice,
        request(app)
          .post("/categories")
          .send({ id: cat, name: "Gone category", type: "EXPENSE" }),
      ).expect(201);
      await as(alice, request(app).delete(`/categories/${cat}`)).expect(200);

      const [result] = await push(alice, [
        op({
          entity: "transaction",
          action: "create",
          id: txId,
          payload: { body: { ...expense(accountId, 15), categoryId: cat } },
        }),
      ]);

      expect(result).toMatchObject({
        status: "applied",
        warnings: ["CATEGORY_ARCHIVED_DROPPED"],
        result: { id: txId, categoryId: null, pendingDetails: true },
      });
      // The movement is never lost, and it moved the money once.
      const stored = await TransactionModel.findById(txId).lean();
      expect(stored?.categoryId).toBeNull();
      expect(stored?.pendingDetails).toBe(true);
      expect(stored?.amount).toBe(1500);
    });

    it("refuses a budget whose category was archived online, rather than counting everything", async () => {
      const cat = uuid("d", 6);
      await as(
        alice,
        request(app)
          .post("/categories")
          .send({ id: cat, name: "Gone budget category", type: "EXPENSE" }),
      ).expect(201);
      await as(alice, request(app).delete(`/categories/${cat}`)).expect(200);

      const [result] = await push(alice, [
        op({
          entity: "budget",
          action: "create",
          id: uuid("b", 3),
          payload: {
            body: {
              name: "Would be global",
              color: "TEAL",
              categoryIds: [cat],
              amount: 100,
              periodType: "MONTHLY",
            },
          },
        }),
      ]);

      expect(result).toMatchObject({
        status: "rejected",
        code: "CATEGORY_ARCHIVED",
      });
      expect(await BudgetModel.findById(uuid("b", 3)).lean()).toBeNull();
    });

    // The route answers 400, not 409, so the batch files it as `rejected`;
    // part 1's note said `conflict` and had never measured it.
    it("files an overlapping budget as rejected BUDGET_PERIOD_OVERLAP", async () => {
      const first = uuid("b", 4);
      const second = uuid("b", 5);
      const globalBudget = (name: string): Record<string, unknown> => ({
        name,
        color: "TEAL",
        categoryIds: [],
        amount: 300,
        periodType: "MONTHLY",
      });

      const results = await push(alice, [
        op({
          entity: "budget",
          action: "create",
          id: first,
          payload: { body: globalBudget("Global one") },
        }),
        op({
          entity: "budget",
          action: "create",
          id: second,
          payload: { body: globalBudget("Global two") },
        }),
      ]);

      expect(statuses(results)).toEqual(["applied", "rejected"]);
      expect(results[1].code).toBe("BUDGET_PERIOD_OVERLAP");
      expect(await BudgetModel.findById(second).lean()).toBeNull();
    });

    it("judges FUTURE_DATE by the server's clock, not the device's", async () => {
      const future = new Date(Date.now() + 48 * 3_600_000).toISOString();

      const [result] = await push(alice, [
        op({
          entity: "transaction",
          action: "create",
          id: uuid("e", 4),
          // A phone two days ahead: occurredAt is data, the date is judged.
          occurredAt: future,
          payload: {
            body: { ...expense(accountId, 5), date: future },
          },
        }),
      ]);

      expect(result).toMatchObject({ status: "rejected", code: "FUTURE_DATE" });
      expect(await TransactionModel.findById(uuid("e", 4)).lean()).toBeNull();
    });

    it("lands an archive of an already-archived row and a delete of an already-deleted movement", async () => {
      const acc = uuid("a", 14);
      const txId = uuid("e", 5);
      await push(alice, [
        op({
          entity: "account",
          action: "create",
          id: acc,
          payload: { body: accountBody("Twice", 100) },
        }),
        op({
          entity: "transaction",
          action: "create",
          id: txId,
          payload: { body: expense(acc, 10) },
          dependsOn: [acc],
        }),
      ]);
      // Another device got there first, with its own opIds.
      await as(alice, request(app).delete(`/transactions/${txId}`)).expect(200);
      await as(alice, request(app).delete(`/accounts/${acc}`)).expect(200);

      const results = await push(alice, [
        op({ entity: "transaction", action: "delete", id: txId }),
        op({ entity: "account", action: "archive", id: acc }),
      ]);

      // Both wanted a state that already holds, so both land (§5.4): nothing
      // for the user to resolve, and the queue drains.
      expect(statuses(results)).toEqual(["duplicate", "applied"]);
      expect(results[0].result).toBeUndefined();
      const stored = await AccountModel.findById(acc).lean();
      expect(stored?.archivedAt).toEqual(expect.any(Date));
    });
  });
});
