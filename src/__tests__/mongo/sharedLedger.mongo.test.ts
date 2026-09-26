/**
 * What the mocked suite cannot see about what counts as yours (T-115): the
 * link between a movement and its shared expense written in one database
 * transaction, the aggregations that now measure `countsAsYours` instead of
 * the amount, and the rows written before the field existed, whose whole
 * amount is theirs.
 */
import request from "supertest";

import app from "../../app";
import { AccountModel } from "../../infrastructure/models/AccountModel";
import { TransactionModel } from "../../infrastructure/models/TransactionModel";
import { connect, disconnect, dropDatabase } from "./support";

interface Session {
  token: string;
  userId: string;
}

const ACCOUNT_ID = "019576a0-d7b6-7d6d-af6a-2b75450a0001";
const CATEGORY_ID = "019576a0-d7b6-7d6d-af6a-2b75450c0001";
const DINNER = 120_000;
const SPENT_ON = "2026-08-12T18:00:00.000Z";
const AUGUST = {
  from: "2026-08-01T05:00:00.000Z",
  to: "2026-09-01T05:00:00.000Z",
};

describe("what counts as yours, against mongod", () => {
  let session: Session;
  let ana: string;
  let groupId: string;

  const as = (req: request.Test): request.Test =>
    req.set("Authorization", `Bearer ${session.token}`);

  const newTransaction = async (
    body: Record<string, unknown>,
  ): Promise<request.Response> =>
    as(
      request(app)
        .post("/transactions")
        .send({
          type: "EXPENSE",
          amount: DINNER,
          date: SPENT_ON,
          description: "Corner store",
          categoryId: CATEGORY_ID,
          fromAccountId: ACCOUNT_ID,
          ...body,
        }),
    );

  const split = async (
    body: Record<string, unknown>,
  ): Promise<request.Response> =>
    as(request(app).post(`/shared-groups/${groupId}/expenses`).send(body));

  const transaction = async (id: string): Promise<request.Response> =>
    as(request(app).get(`/transactions/${id}`));

  const spentInAugust = async (): Promise<number> => {
    const res = await as(
      request(app).get(
        `/stats/spending?groupBy=category&type=EXPENSE&from=${AUGUST.from}&to=${AUGUST.to}`,
      ),
    );
    expect(res.status).toBe(200);
    return res.body.total as number;
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const registered = await request(app).post("/auth/register").send({
      name: "Owner",
      email: "owner@shared-ledger.test",
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

  describe("splitting a movement", () => {
    it("takes the figures from the movement and writes the link and its history", async () => {
      const created = await newTransaction({});
      expect(created.status).toBe(201);
      expect(created.body.countsAsYours).toBe(DINNER);
      expect(created.body.sharedExpenseId).toBeNull();
      expect(created.body.sharedHistory).toEqual([]);

      const expense = await split({ transactionId: created.body.id });

      expect(expense.status).toBe(201);
      expect(expense.body.amount).toBe(DINNER);
      expect(expense.body.date).toBe(SPENT_ON);
      expect(expense.body.description).toBe("Corner store");
      expect(
        expense.body.split.shares.map((s: { amount: number }) => s.amount),
      ).toEqual([60_000, 60_000]);

      const linked = await transaction(created.body.id);
      expect(linked.body.sharedExpenseId).toBe(expense.body.id);
      expect(linked.body.sharedGroupId).toBe(groupId);
      // Splitting moves nothing: the money left the account when it was spent.
      expect(linked.body.countsAsYours).toBe(DINNER);
      expect(linked.body.sharedHistory).toEqual([
        {
          at: expect.any(String),
          reason: "SPLIT",
          countsAsYours: DINNER,
        },
      ]);
    });

    it("refuses a movement that is already in a group", async () => {
      const created = await newTransaction({});
      expect((await split({ transactionId: created.body.id })).status).toBe(
        201,
      );

      const again = await split({ transactionId: created.body.id });

      expect(again.status).toBe(400);
      expect(again.body.code).toBe("TRANSACTION_ALREADY_SHARED");
    });

    it("refuses anything that is not an expense", async () => {
      const income = await newTransaction({
        type: "INCOME",
        fromAccountId: null,
        toAccountId: ACCOUNT_ID,
        categoryId: null,
      });
      expect(income.status).toBe(201);

      const res = await split({ transactionId: income.body.id });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("TRANSACTION_NOT_SPLITTABLE");
    });

    it("refuses a movement of somebody else's the same way as a missing one", async () => {
      const stranger = await request(app).post("/auth/register").send({
        name: "Stranger",
        email: "stranger@shared-ledger.test",
        password: "Offline!2026",
      });
      const theirAccount = await request(app)
        .post("/accounts")
        .set("Authorization", `Bearer ${stranger.body.accessToken}`)
        .send({ name: "Theirs", type: "ACCOUNT", balance: 100_000 });
      const theirs = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${stranger.body.accessToken}`)
        .send({
          type: "EXPENSE",
          amount: 10_000,
          date: SPENT_ON,
          fromAccountId: theirAccount.body.id,
        });
      expect(theirs.status).toBe(201);

      const res = await split({ transactionId: theirs.body.id });

      expect(res.status).toBe(404);
    });
  });

  describe("the two sides stay one fact", () => {
    it("resolves the split again when the movement states another amount", async () => {
      const created = await newTransaction({});
      const expense = await split({ transactionId: created.body.id });

      const raised = await as(
        request(app)
          .put(`/transactions/${created.body.id}`)
          .send({ amount: 150_000, description: "Dinner" }),
      );

      expect(raised.status).toBe(200);
      expect(raised.body.countsAsYours).toBe(150_000);
      expect(raised.body.sharedHistory.at(-1)).toMatchObject({
        reason: "AMOUNT_CHANGED",
        countsAsYours: 150_000,
      });
      const restated = await as(
        request(app).get(
          `/shared-groups/${groupId}/expenses/${expense.body.id}`,
        ),
      );
      expect(restated.body.amount).toBe(150_000);
      expect(restated.body.description).toBe("Dinner");
      expect(
        restated.body.split.shares.map((s: { amount: number }) => s.amount),
      ).toEqual([75_000, 75_000]);
    });

    it("refuses the amount when the split states exact figures", async () => {
      const created = await newTransaction({});
      const expense = await split({
        transactionId: created.body.id,
        split: {
          mode: "EXACT",
          shares: [
            { party: "USER", fixedAmount: 100_000 },
            { party: "CONTACT", contactId: ana, fixedAmount: 20_000 },
          ],
        },
      });
      expect(expense.status).toBe(201);

      const res = await as(
        request(app)
          .put(`/transactions/${created.body.id}`)
          .send({ amount: 150_000 }),
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SPLIT_INVALID");
      const untouched = await transaction(created.body.id);
      expect(untouched.body.amount).toBe(DINNER);
    });

    it("refuses to restate on the expense what the movement states", async () => {
      const created = await newTransaction({});
      const expense = await split({ transactionId: created.body.id });

      const res = await as(
        request(app)
          .put(`/shared-groups/${groupId}/expenses/${expense.body.id}`)
          .send({ amount: 90_000 }),
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SHARED_EXPENSE_LINKED");
    });

    it("takes the expense out of the group with the movement", async () => {
      const created = await newTransaction({});
      const expense = await split({ transactionId: created.body.id });

      const deleted = await as(
        request(app).delete(`/transactions/${created.body.id}`),
      );

      expect(deleted.status).toBe(200);
      const listed = await as(
        request(app).get(`/shared-groups/${groupId}/expenses`),
      );
      expect(listed.body.data.map((e: { id: string }) => e.id)).not.toContain(
        expense.body.id,
      );
    });

    it("gives the whole amount back when the expense leaves the group", async () => {
      const created = await newTransaction({});
      const expense = await split({ transactionId: created.body.id });

      const removed = await as(
        request(app).delete(
          `/shared-groups/${groupId}/expenses/${expense.body.id}`,
        ),
      );

      expect(removed.status).toBe(200);
      const free = await transaction(created.body.id);
      expect(free.body.sharedExpenseId).toBeNull();
      expect(free.body.sharedGroupId).toBeNull();
      expect(free.body.countsAsYours).toBe(DINNER);
      expect(free.body.sharedHistory.at(-1)).toMatchObject({
        reason: "UNSPLIT",
        countsAsYours: DINNER,
      });
    });
  });

  describe("the description", () => {
    it("is the movement's, and cannot be stated beside it", async () => {
      const created = await newTransaction({});

      const stated = await split({
        transactionId: created.body.id,
        description: "Something else",
      });

      expect(stated.status).toBe(400);
      expect(stated.body.code).toBe("VALIDATION");
    });

    it("follows the movement when it is edited", async () => {
      const created = await newTransaction({});
      const expense = await split({ transactionId: created.body.id });

      await as(
        request(app)
          .put(`/transactions/${created.body.id}`)
          .send({ description: "Dinner with Ana" }),
      );

      const restated = await as(
        request(app).get(
          `/shared-groups/${groupId}/expenses/${expense.body.id}`,
        ),
      );
      expect(restated.body.description).toBe("Dinner with Ana");
    });
  });

  describe("adding people to the group afterwards", () => {
    it("says in each movement's history that its split changed", async () => {
      const created = await newTransaction({});
      await split({ transactionId: created.body.id });
      const carla = await as(
        request(app).post("/contacts").send({ name: "Carla" }),
      );

      const added = await as(
        request(app)
          .post(`/shared-groups/${groupId}/participants`)
          .send({
            contactIds: [carla.body.id],
            applyToExistingExpenses: true,
          }),
      );

      expect(added.status).toBe(200);
      const movement = await transaction(created.body.id);
      expect(
        movement.body.sharedHistory.map((e: { reason: string }) => e.reason),
      ).toEqual(["SPLIT", "SPLIT_EDITED"]);
      // What each person owes changed; what counts as yours did not.
      expect(movement.body.countsAsYours).toBe(DINNER);
    });
  });

  describe("through the offline batch", () => {
    it("deletes the expense with the movement", async () => {
      const created = await newTransaction({});
      const expense = await split({ transactionId: created.body.id });

      const batch = await as(
        request(app)
          .post("/sync")
          .send({
            operations: [
              {
                opId: "01930001-0000-7000-8000-00000000f001",
                seq: 1,
                occurredAt: "2026-09-05T10:00:00.000Z",
                opVersion: 1,
                entity: "transaction",
                action: "delete",
                id: created.body.id,
              },
            ],
          }),
      );

      expect(batch.status).toBe(200);
      expect(batch.body.results[0].status).toBe("applied");
      const listed = await as(
        request(app).get(`/shared-groups/${groupId}/expenses`),
      );
      expect(listed.body.data.map((e: { id: string }) => e.id)).not.toContain(
        expense.body.id,
      );
    });
  });

  describe("finding the movement of a shared expense", () => {
    it("reads one index entry instead of the user's history", async () => {
      // The suite drops the database after connecting, so the indexes are built here.
      await TransactionModel.createIndexes();
      const created = await newTransaction({});
      const expense = await split({ transactionId: created.body.id });

      const plan = (await TransactionModel.find({
        userId: session.userId,
        sharedExpenseId: expense.body.id,
        deletedAt: null,
      }).explain("executionStats")) as unknown as {
        executionStats: { totalDocsExamined: number; nReturned: number };
      };

      expect(plan.executionStats.nReturned).toBe(1);
      // A plan that ignored the partial index would read every movement of the user's.
      expect(plan.executionStats.totalDocsExamined).toBe(1);
    });

    it("lets one movement at most claim an expense", async () => {
      await TransactionModel.createIndexes();
      const created = await newTransaction({});
      const expense = await split({ transactionId: created.body.id });
      const other = await newTransaction({});

      const claimed = TransactionModel.updateOne(
        { _id: other.body.id },
        { $set: { sharedExpenseId: expense.body.id, sharedGroupId: groupId } },
      );

      await expect(claimed).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe("the rule the whole feature obeys", () => {
    /**
     * What counts as yours, added up, is what left the accounts minus what
     * came back. Nothing can come back until payments exist (T-116), so the
     * second term is zero here and that task fills it in.
     */
    it("holds after splitting, editing, re-splitting, unsplitting and deleting", async () => {
      await TransactionModel.deleteMany({ userId: session.userId });
      const opening =
        (await AccountModel.findById(ACCOUNT_ID).lean())?.balance ?? 0;

      const kept = await newTransaction({});
      const edited = await newTransaction({ amount: 80_000 });
      const freed = await newTransaction({ amount: 45_000 });
      const gone = await newTransaction({ amount: 30_000 });

      const keptExpense = await split({ transactionId: kept.body.id });
      await split({ transactionId: edited.body.id });
      const freedExpense = await split({ transactionId: freed.body.id });
      await split({ transactionId: gone.body.id });

      await as(
        request(app)
          .put(`/transactions/${edited.body.id}`)
          .send({ amount: 96_000 }),
      );
      await as(
        request(app)
          .put(`/shared-groups/${groupId}/expenses/${keptExpense.body.id}`)
          .send({
            split: {
              mode: "EQUAL",
              shares: [{ party: "USER" }, { party: "CONTACT", contactId: ana }],
            },
          }),
      );
      await as(
        request(app).delete(
          `/shared-groups/${groupId}/expenses/${freedExpense.body.id}`,
        ),
      );
      await as(request(app).delete(`/transactions/${gone.body.id}`));

      const live = await TransactionModel.find({
        userId: session.userId,
        deletedAt: null,
      }).lean();
      const yours = live.reduce(
        (sum, row) => sum + (row.countsAsYours ?? row.amount),
        0,
      );
      const balance =
        (await AccountModel.findById(ACCOUNT_ID).lean())?.balance ?? 0;
      const leftTheAccounts = opening - balance;
      const cameBack = 0;

      expect(yours).toBe(leftTheAccounts - cameBack);
      expect(yours).toBe((120_000 + 96_000 + 45_000) * 100);
    });
  });

  describe("what Stats and the budgets measure", () => {
    it("reads what counts as yours, while the list stays gross", async () => {
      await TransactionModel.deleteMany({ userId: session.userId });
      const created = await newTransaction({});
      // What a payment will write (T-116): half of it came back, so half of it is yours, in cents.
      await TransactionModel.updateOne(
        { _id: created.body.id },
        { $set: { countsAsYours: 60_000 * 100 } },
        { timestamps: false },
      );

      expect(await spentInAugust()).toBe(60_000);
      const budget = await as(
        request(app).post("/budgets").send({
          name: "August",
          color: "INDIGO",
          categoryIds: [],
          type: "EXPENSE",
          periodType: "MONTHLY",
          amount: 1_000_000,
          effectiveFrom: "2026-01-01T05:00:00.000Z",
        }),
      );
      expect(budget.status).toBe(201);
      const seen = await as(
        request(app).get("/budgets?reference=2026-08-15T12:00:00.000Z"),
      );
      expect(seen.body.data[0].spent).toBe(60_000);

      const list = await as(
        request(app).get(
          `/transactions?from=${AUGUST.from}&to=${AUGUST.to}&includeSummary=true`,
        ),
      );
      // The list is what moved through the accounts, and that was the whole dinner.
      expect(list.body.summary).toEqual({ expense: DINNER, income: 0 });
      expect(list.body.data[0].amount).toBe(DINNER);
      expect(list.body.data[0].countsAsYours).toBe(60_000);
    });

    it("gives a row written before the field existed its figure on the next edit", async () => {
      await TransactionModel.deleteMany({ userId: session.userId });
      const created = await newTransaction({});
      await TransactionModel.updateOne(
        { _id: created.body.id },
        { $unset: { countsAsYours: 1 } },
        { timestamps: false },
      );

      const edited = await as(
        request(app)
          .put(`/transactions/${created.body.id}`)
          .send({ amount: 90_000 }),
      );

      expect(edited.body.countsAsYours).toBe(90_000);
      expect(await spentInAugust()).toBe(90_000);
    });

    it("counts the whole amount of a row written before the field existed", async () => {
      await TransactionModel.deleteMany({ userId: session.userId });
      const created = await newTransaction({});
      await TransactionModel.updateOne(
        { _id: created.body.id },
        { $unset: { countsAsYours: 1 } },
        { timestamps: false },
      );
      expect(
        (await TransactionModel.findById(created.body.id).lean())
          ?.countsAsYours,
      ).toBeUndefined();

      expect(await spentInAugust()).toBe(DINNER);
      const read = await transaction(created.body.id);
      expect(read.body.countsAsYours).toBe(DINNER);
    });
  });
});
