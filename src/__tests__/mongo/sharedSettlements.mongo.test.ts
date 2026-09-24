/**
 * What the mocked suite cannot see about paying and being paid (T-116): the
 * imputation over real rows, the movements a settle-up writes and reverses
 * inside one database transaction, what that leaves Stats and the budgets
 * measuring, and the balances underneath it all.
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

const ACCOUNT_ID = "019576a0-d7b6-7d6d-af6a-2b7545500001";
const CATEGORY_ID = "019576a0-d7b6-7d6d-af6a-2b7545500002";
const OPENING = 5_000_000;
const AUGUST = {
  from: "2026-08-01T05:00:00.000Z",
  to: "2026-09-01T05:00:00.000Z",
};

describe("paying and being paid, against mongod", () => {
  let session: Session;
  let ana: string;
  let groupId: string;

  const as = (req: request.Test): request.Test =>
    req.set("Authorization", `Bearer ${session.token}`);

  const newExpense = async (
    body: Record<string, unknown>,
  ): Promise<request.Response> =>
    as(request(app).post(`/shared-groups/${groupId}/expenses`).send(body));

  const spentFromYourAccount = async (
    amount: number,
    date: string,
    description: string,
  ): Promise<string> => {
    const created = await as(
      request(app).post("/transactions").send({
        type: "EXPENSE",
        amount,
        date,
        description,
        categoryId: CATEGORY_ID,
        fromAccountId: ACCOUNT_ID,
      }),
    );
    expect(created.status).toBe(201);
    return created.body.id as string;
  };

  const settle = async (
    body: Record<string, unknown>,
  ): Promise<request.Response> =>
    as(request(app).post("/settlements").send(body));

  const movement = async (id: string): Promise<Record<string, unknown>> => {
    const res = await as(request(app).get(`/transactions/${id}`));
    expect(res.status).toBe(200);
    return res.body as Record<string, unknown>;
  };

  const spentInAugust = async (): Promise<number> => {
    const res = await as(
      request(app).get(
        `/stats/spending?groupBy=category&type=EXPENSE&from=${AUGUST.from}&to=${AUGUST.to}`,
      ),
    );
    expect(res.status).toBe(200);
    return res.body.total as number;
  };

  // Stored in integer cents, which is what these assertions compare.
  const balance = async (): Promise<number> =>
    (await AccountModel.findById(ACCOUNT_ID).lean())?.balance ?? 0;
  const cents = (amount: number): number => amount * 100;

  const groupTotals = async (): Promise<Record<string, number>> => {
    const res = await as(request(app).get(`/shared-groups/${groupId}`));
    expect(res.status).toBe(200);
    return res.body.totals as Record<string, number>;
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const registered = await request(app).post("/auth/register").send({
      name: "Owner",
      email: "owner@settlements.test",
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
            balance: OPENING,
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

  describe("a collection", () => {
    let older: string;
    let newer: string;

    beforeEach(async () => {
      await dropSettlementsAndExpenses();
      older = await spentFromYourAccount(
        90_000,
        "2026-08-10T18:00:00.000Z",
        "Dinner",
      );
      newer = await spentFromYourAccount(
        60_000,
        "2026-08-20T18:00:00.000Z",
        "Taxi",
      );
      expect((await newExpense({ transactionId: older })).status).toBe(201);
      expect((await newExpense({ transactionId: newer })).status).toBe(201);
    });

    it("covers the oldest line first and comes off what counts as yours", async () => {
      const before = await balance();

      const paid = await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 30_000,
        accountId: ACCOUNT_ID,
      });

      expect(paid.status).toBe(201);
      expect(paid.body.covered).toEqual([
        {
          expenseId: expect.any(String),
          description: "Dinner",
          date: "2026-08-10T18:00:00.000Z",
          amount: 30_000,
          direction: "COLLECTED",
        },
      ]);
      // It came back, so it stops counting as spent — in the month the expense happened.
      expect((await movement(older)).countsAsYours).toBe(60_000);
      expect((await movement(newer)).countsAsYours).toBe(60_000);
      expect(await balance()).toBe(before + cents(30_000));
    });

    it("says so in the history of the movement it lands on", async () => {
      await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 30_000,
        accountId: ACCOUNT_ID,
      });

      const history = (await movement(older)).sharedHistory as {
        reason: string;
        countsAsYours: number;
      }[];
      expect(history.map((entry) => entry.reason)).toEqual([
        "SPLIT",
        "PAYMENT",
      ]);
      expect(history[history.length - 1]?.countsAsYours).toBe(60_000);
    });

    it("spills onto the next line once the oldest is square", async () => {
      await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 60_000,
        accountId: ACCOUNT_ID,
      });

      // Her share of the dinner is 45.000, so 15.000 reach the taxi.
      expect((await movement(older)).countsAsYours).toBe(45_000);
      expect((await movement(newer)).countsAsYours).toBe(45_000);
    });

    it("is not income: Stats and the budgets only see what is left as yours", async () => {
      await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 60_000,
        accountId: ACCOUNT_ID,
      });

      expect(await spentInAugust()).toBe(90_000);
      const budget = await as(
        request(app)
          .post("/budgets")
          .send({
            name: `August ${Date.now()}`,
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
      expect(seen.body.data[0].spent).toBe(90_000);
      await as(request(app).delete(`/budgets/${budget.body.id}`));
    });

    it("moves no account when it happened outside the app", async () => {
      const before = await balance();

      const paid = await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 30_000,
        outsideApp: true,
      });

      expect(paid.status).toBe(201);
      expect(await balance()).toBe(before);
      // That money did come back, so it stops counting as yours all the same.
      expect((await movement(older)).countsAsYours).toBe(60_000);
    });

    it("gives the group what people still owe and what has come back", async () => {
      await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 30_000,
        accountId: ACCOUNT_ID,
      });

      const totals = await groupTotals();
      expect(totals.owedToYou).toBe(45_000);
      expect(totals.collected).toBe(30_000);
      expect(totals.youOwe).toBe(0);
    });

    it("comes undone, movements and figures, when the payment is deleted", async () => {
      const before = await balance();
      const paid = await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 30_000,
        accountId: ACCOUNT_ID,
      });

      const undone = await as(
        request(app).delete(`/settlements/${paid.body.settlement.id}`),
      );

      expect(undone.status).toBe(200);
      expect(await balance()).toBe(before);
      expect((await movement(older)).countsAsYours).toBe(90_000);
      const entries = (await movement(older)).sharedHistory as {
        reason: string;
      }[];
      expect(entries[entries.length - 1]?.reason).toBe("REIMPUTED");
    });
  });

  describe("paying somebody back", () => {
    let hers: string;

    beforeEach(async () => {
      await dropSettlementsAndExpenses();
      const created = await newExpense({
        description: "Tickets",
        date: "2026-08-12T18:00:00.000Z",
        amount: 90_000,
        paidByContactId: ana,
      });
      expect(created.status).toBe(201);
      hers = created.body.id as string;
    });

    it("is your expense on her line, dated that line and in the category you give", async () => {
      const before = await balance();

      const paid = await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        paid: 45_000,
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
      });

      expect(paid.status).toBe(201);
      expect(paid.body.covered).toEqual([
        {
          expenseId: hers,
          description: "Tickets",
          date: "2026-08-12T18:00:00.000Z",
          amount: 45_000,
          direction: "PAID",
        },
      ]);
      expect(await balance()).toBe(before - cents(45_000));
      const list = await as(
        request(app).get(
          `/transactions?from=${AUGUST.from}&to=${AUGUST.to}&type=EXPENSE`,
        ),
      );
      const mine = list.body.data.find(
        (row: { description: string }) => row.description === "Tickets",
      );
      expect(mine.date).toBe("2026-08-12T18:00:00.000Z");
      expect(mine.categoryId).toBe(CATEGORY_ID);
      expect(mine.countsAsYours).toBe(45_000);
      // Your share of her line is spending of yours, unlike the money coming back.
      expect(await spentInAugust()).toBe(45_000);
    });

    it("refuses more than you owe them", async () => {
      const res = await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        paid: 90_000,
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SETTLEMENT_OVER_PAID");
    });

    it("needs a category, because the shared layer carries none", async () => {
      const res = await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        paid: 45_000,
        accountId: ACCOUNT_ID,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
    });
  });

  describe("both directions at once", () => {
    it("writes the two halves, and the balance moves by the net", async () => {
      await dropSettlementsAndExpenses();
      const yours = await spentFromYourAccount(
        120_000,
        "2026-08-10T18:00:00.000Z",
        "Dinner",
      );
      expect((await newExpense({ transactionId: yours })).status).toBe(201);
      expect(
        (
          await newExpense({
            description: "Tickets",
            date: "2026-08-11T18:00:00.000Z",
            amount: 60_000,
            paidByContactId: ana,
          })
        ).status,
      ).toBe(201);
      const before = await balance();

      const paid = await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 60_000,
        paid: 30_000,
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
      });

      expect(paid.status).toBe(201);
      expect(await balance()).toBe(before + cents(30_000));
      expect((await movement(yours)).countsAsYours).toBe(60_000);
      const totals = await groupTotals();
      expect(totals.owedToYou).toBe(0);
      expect(totals.youOwe).toBe(0);
      const group = await as(request(app).get(`/shared-groups/${groupId}`));
      expect(group.body.status).toBe("SETTLED");
    });
  });

  describe("the fifth kind of movement", () => {
    let collectionId: string;

    beforeEach(async () => {
      await dropSettlementsAndExpenses();
      const yours = await spentFromYourAccount(
        90_000,
        "2026-08-10T18:00:00.000Z",
        "Dinner",
      );
      expect((await newExpense({ transactionId: yours })).status).toBe(201);
      const paid = await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 45_000,
        accountId: ACCOUNT_ID,
      });
      const list = await as(
        request(app).get("/transactions?type=SETTLEMENT&limit=1"),
      );
      expect(paid.status).toBe(201);
      collectionId = list.body.data[0].id as string;
    });

    it("is listed, filtered by type, and carries no category", async () => {
      const row = await movement(collectionId);

      expect(row.type).toBe("SETTLEMENT");
      expect(row.categoryId).toBeNull();
      expect(row.toAccountId).toBe(ACCOUNT_ID);
    });

    it("cannot be written by hand: Settle up records it", async () => {
      const res = await as(
        request(app).post("/transactions").send({
          type: "SETTLEMENT",
          amount: 1000,
          date: "2026-08-25T18:00:00.000Z",
          toAccountId: ACCOUNT_ID,
        }),
      );

      expect(res.status).toBe(400);
    });

    it("cannot be edited or deleted on its own", async () => {
      const edited = await as(
        request(app)
          .put(`/transactions/${collectionId}`)
          .send({ amount: 10_000 }),
      );
      const deleted = await as(
        request(app).delete(`/transactions/${collectionId}`),
      );

      expect(edited.status).toBe(400);
      expect(edited.body.code).toBe("SETTLEMENT_MOVEMENT_LOCKED");
      expect(deleted.status).toBe(400);
      expect(deleted.body.code).toBe("SETTLEMENT_MOVEMENT_LOCKED");
    });

    it("stays out of Stats unless it is asked for by name", async () => {
      const everything = await as(
        request(app).get(
          `/stats/spending?groupBy=month&from=${AUGUST.from}&to=${AUGUST.to}`,
        ),
      );
      const asked = await as(
        request(app).get(
          `/stats/spending?groupBy=month&type=SETTLEMENT&from=${AUGUST.from}&to=${AUGUST.to}`,
        ),
      );

      expect(everything.body.total).toBe(45_000);
      expect(asked.body.total).toBe(45_000);
    });
  });

  /**
   * The rule the whole feature obeys: what counts as yours is what left your
   * accounts as spending, minus what came back for it. Money of theirs that
   * covers no line is a surplus you hold, not a repayment, and what you hand
   * back stops being one too.
   */
  const moneyRule = async (money: {
    collected: number;
    refunded?: number;
    surplus?: number;
  }): Promise<void> => {
    const rows = await TransactionModel.find({
      userId: session.userId,
      type: "EXPENSE",
      deletedAt: null,
    }).lean();
    const spent = rows.reduce((sum, row) => sum + row.amount, 0);
    const yours = rows.reduce(
      (sum, row) => sum + (row.countsAsYours ?? row.amount),
      0,
    );
    expect(yours).toBe(
      spent -
        cents(money.collected) +
        cents(money.refunded ?? 0) +
        cents(money.surplus ?? 0),
    );
  };

  describe("a block of guests", () => {
    let party: string;
    let expenseId: string;

    beforeEach(async () => {
      await dropSettlementsAndExpenses();
      party = await spentFromYourAccount(
        230_000,
        "2026-08-18T18:00:00.000Z",
        "Party",
      );
      const created = await newExpense({
        transactionId: party,
        split: {
          mode: "EQUAL",
          guests: { count: 20, name: "The office" },
          shares: [
            { party: "USER" },
            { party: "CONTACT", contactId: ana },
            { party: "GUESTS" },
          ],
        },
      });
      expect(created.status).toBe(201);
      expenseId = created.body.id as string;
    });

    it("is collected from like anybody else, in part and in full", async () => {
      const part = await settle({
        expenseId,
        date: "2026-08-28T18:00:00.000Z",
        collected: 100_000,
        accountId: ACCOUNT_ID,
      });

      expect(part.status).toBe(201);
      // 230.000 over 22 parts: the block weighs twenty of them.
      expect((await movement(party)).countsAsYours).toBe(130_000);
      await moneyRule({ collected: 100_000, refunded: 0 });

      const rest = await settle({
        expenseId,
        date: "2026-08-29T18:00:00.000Z",
        collected: 109_090,
        outsideApp: true,
      });

      expect(rest.status).toBe(201);
      expect((await movement(party)).countsAsYours).toBe(20_910);
      await moneyRule({ collected: 209_090, refunded: 0 });
    });

    it("cannot be left behind: its expense does not go while it has paid", async () => {
      await settle({
        expenseId,
        date: "2026-08-28T18:00:00.000Z",
        collected: 100_000,
        accountId: ACCOUNT_ID,
      });

      const deleted = await as(request(app).delete(`/transactions/${party}`));
      const removed = await as(
        request(app).delete(`/shared-groups/${groupId}/expenses/${expenseId}`),
      );

      expect(deleted.status).toBe(400);
      expect(deleted.body.code).toBe("GUEST_BLOCK_HAS_PAYMENTS");
      expect(removed.status).toBe(400);
      expect(removed.body.code).toBe("GUEST_BLOCK_HAS_PAYMENTS");
    });
  });

  describe("giving back what they paid ahead", () => {
    let dinner: string;

    beforeEach(async () => {
      await dropSettlementsAndExpenses();
      dinner = await spentFromYourAccount(
        100_000,
        "2026-08-10T18:00:00.000Z",
        "Dinner",
      );
      expect(
        (
          await newExpense({
            transactionId: dinner,
            split: {
              mode: "EXACT",
              shares: [
                { party: "USER", fixedAmount: 60_000 },
                { party: "CONTACT", contactId: ana, fixedAmount: 40_000 },
              ],
            },
          })
        ).status,
      ).toBe(201);
    });

    it("leaves as it came, and stops paying for what comes next", async () => {
      const before = await balance();
      await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 100_000,
        accountId: ACCOUNT_ID,
      });
      expect((await movement(dinner)).countsAsYours).toBe(60_000);

      const back = await settle({
        contactId: ana,
        date: "2026-08-26T18:00:00.000Z",
        paid: 60_000,
        accountId: ACCOUNT_ID,
      });

      expect(back.status).toBe(201);
      expect(back.body.refunded).toBe(60_000);
      expect(back.body.covered).toEqual([]);
      expect(await balance()).toBe(before + cents(40_000));
      await moneyRule({ collected: 100_000, refunded: 60_000 });

      // What was given back cannot pay for a line recorded afterwards.
      const later = await spentFromYourAccount(
        50_000,
        "2026-08-27T18:00:00.000Z",
        "Taxi",
      );
      expect((await newExpense({ transactionId: later })).status).toBe(201);

      expect((await movement(later)).countsAsYours).toBe(50_000);
      await moneyRule({ collected: 100_000, refunded: 60_000 });
    });

    it("refuses to hand back more than they ever paid ahead", async () => {
      const res = await settle({
        contactId: ana,
        date: "2026-08-26T18:00:00.000Z",
        paid: 10_000,
        accountId: ACCOUNT_ID,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SETTLEMENT_OVER_PAID");
    });
  });

  describe("what a payment covers is imputed again", () => {
    let older: string;
    let newer: string;

    beforeEach(async () => {
      await dropSettlementsAndExpenses();
      older = await spentFromYourAccount(
        90_000,
        "2026-08-10T18:00:00.000Z",
        "Dinner",
      );
      newer = await spentFromYourAccount(
        60_000,
        "2026-08-20T18:00:00.000Z",
        "Taxi",
      );
      expect((await newExpense({ transactionId: older })).status).toBe(201);
      expect((await newExpense({ transactionId: newer })).status).toBe(201);
      await settle({
        contactId: ana,
        date: "2026-08-25T18:00:00.000Z",
        collected: 45_000,
        accountId: ACCOUNT_ID,
      });
      expect((await movement(older)).countsAsYours).toBe(45_000);
    });

    it("when the line it landed on is deleted", async () => {
      const gone = await as(request(app).delete(`/transactions/${older}`));

      expect(gone.status).toBe(200);
      // Her 45.000 are still hers: they now cover what is left, oldest first.
      expect((await movement(newer)).countsAsYours).toBe(30_000);
      // Her 45.000 only cover 30.000 now: the rest is hers, sitting in your account.
      await moneyRule({ collected: 45_000, surplus: 15_000 });
    });

    it("when a split changes what she owes", async () => {
      const expenses = await as(
        request(app).get(`/shared-groups/${groupId}/expenses`),
      );
      const oldest = expenses.body.data.find(
        (one: { description: string }) => one.description === "Dinner",
      );

      const edited = await as(
        request(app)
          .put(`/shared-groups/${groupId}/expenses/${oldest.id}`)
          .send({
            split: {
              mode: "EXACT",
              shares: [
                { party: "USER", fixedAmount: 80_000 },
                { party: "CONTACT", contactId: ana, fixedAmount: 10_000 },
              ],
            },
          }),
      );

      expect(edited.status).toBe(200);
      // She only owes 10.000 here now, so 35.000 of hers move on to the next line.
      expect((await movement(older)).countsAsYours).toBe(80_000);
      expect((await movement(newer)).countsAsYours).toBe(30_000);
      await moneyRule({ collected: 45_000, surplus: 5_000 });
    });

    it("when a new date makes another line the oldest", async () => {
      const moved = await as(
        request(app)
          .put(`/transactions/${newer}`)
          .send({ date: "2026-08-01T18:00:00.000Z" }),
      );

      expect(moved.status).toBe(200);
      // The taxi is the oldest line now: her 45.000 cover its 30.000 first.
      expect((await movement(newer)).countsAsYours).toBe(30_000);
      expect((await movement(older)).countsAsYours).toBe(75_000);
      await moneyRule({ collected: 45_000 });
    });
  });

  describe("in a currency with cents [T-157]", () => {
    let usd: Session;
    const USD_ACCOUNT = "019576a0-d7b6-7d6d-af6a-2b7545500011";
    const USD_CATEGORY = "019576a0-d7b6-7d6d-af6a-2b7545500012";
    const DAY = "2026-08-25T18:00:00.000Z";
    const asUsd = (req: request.Test): request.Test =>
      req.set("Authorization", `Bearer ${usd.token}`);

    const groupWith = async (
      name: string,
    ): Promise<{ contactId: string; groupId: string }> => {
      const contact = await asUsd(
        request(app).post("/contacts").send({ name }),
      ).expect(201);
      const group = await asUsd(
        request(app)
          .post("/shared-groups")
          .send({ name: `With ${name}`, contactIds: [contact.body.id] }),
      ).expect(201);
      return { contactId: contact.body.id, groupId: group.body.id };
    };

    const theyPaid = async (
      groupId: string,
      contactId: string,
    ): Promise<request.Response> =>
      asUsd(
        request(app).post(`/shared-groups/${groupId}/expenses`).send({
          description: "Coffee",
          date: "2026-08-12T18:00:00.000Z",
          amount: 0.6,
          paidByContactId: contactId,
        }),
      ).expect(201);

    const youPaid = async (groupId: string): Promise<request.Response> => {
      const spent = await asUsd(
        request(app).post("/transactions").send({
          type: "EXPENSE",
          amount: 0.6,
          date: "2026-08-12T18:00:00.000Z",
          description: "Lunch",
          categoryId: USD_CATEGORY,
          fromAccountId: USD_ACCOUNT,
        }),
      ).expect(201);
      return asUsd(
        request(app)
          .post(`/shared-groups/${groupId}/expenses`)
          .send({ transactionId: spent.body.id }),
      ).expect(201);
    };

    const settleUsd = (body: Record<string, unknown>): request.Test =>
      asUsd(
        request(app)
          .post("/settlements")
          .send({ date: DAY, accountId: USD_ACCOUNT, ...body }),
      );

    const recorded = async (settlementId: string): Promise<unknown[][]> =>
      (
        await TransactionModel.find({
          userId: usd.userId,
          sharedSettlementId: settlementId,
        }).lean()
      )
        .map((one) => [one.type, one.amount])
        .sort();

    beforeAll(async () => {
      const registered = await request(app).post("/auth/register").send({
        name: "Dollars",
        email: "dollars@settlements.test",
        password: "Offline!2026",
        currency: "USD",
      });
      expect(registered.status).toBe(201);
      usd = {
        token: registered.body.accessToken,
        userId: registered.body.user.id,
      };
      await asUsd(
        request(app).post("/accounts").send({
          id: USD_ACCOUNT,
          name: "Checking",
          type: "ACCOUNT",
          balance: 100,
        }),
      ).expect(201);
      await asUsd(
        request(app)
          .post("/categories")
          .send({ id: USD_CATEGORY, name: "Dinners", type: "EXPENSE" }),
      ).expect(201);
    });

    it("pays a share in two goes without a refund of nothing", async () => {
      const { contactId, groupId } = await groupWith("Bea");
      const coffee = await theyPaid(groupId, contactId);
      const pay = (paid: number): request.Test =>
        settleUsd({ contactId, paid, categoryId: USD_CATEGORY });

      await pay(0.1).expect(201);
      const second = await pay(0.2).expect(201);

      expect(second.body.refunded).toBe(0);
      expect(second.body.covered).toEqual([
        expect.objectContaining({
          expenseId: coffee.body.id,
          amount: 0.2,
          direction: "PAID",
        }),
      ]);
      expect(await recorded(second.body.settlement.id)).toEqual([
        ["EXPENSE", 20],
      ]);
    });

    it("is collected in two goes to the exact cent", async () => {
      const { contactId, groupId } = await groupWith("Cara");
      const lunch = await youPaid(groupId);
      const collect = (collected: number): request.Test =>
        settleUsd({ contactId, collected });

      await collect(0.1).expect(201);
      const second = await collect(0.2).expect(201);

      expect(second.body.covered).toEqual([
        expect.objectContaining({
          expenseId: lunch.body.id,
          amount: 0.2,
          direction: "COLLECTED",
        }),
      ]);
      expect(await recorded(second.body.settlement.id)).toEqual([
        ["SETTLEMENT", 20],
      ]);
    });

    it("still hands back what they paid ahead, to the cent", async () => {
      const { contactId, groupId } = await groupWith("Dani");
      await youPaid(groupId);
      await settleUsd({ contactId, collected: 0.35 }).expect(201);
      await theyPaid(groupId, contactId);

      const paid = await settleUsd({
        contactId,
        paid: 0.35,
        categoryId: USD_CATEGORY,
      }).expect(201);

      expect(paid.body.refunded).toBe(0.05);
      expect(await recorded(paid.body.settlement.id)).toEqual([
        ["EXPENSE", 30],
        ["SETTLEMENT", 5],
      ]);
    });
  });

  async function dropSettlementsAndExpenses(): Promise<void> {
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
    // The movements of the previous case would keep counting in August otherwise.
    await TransactionModel.deleteMany({ userId: session.userId });
  }
});
