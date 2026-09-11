/**
 * T-14: a past expense must not change day, month or budget period when the
 * account moves to another timezone. Needs a real mongod: the whole point is
 * what the aggregation pipeline matches and groups, which mocks cannot show.
 *
 * The edge that used to move is the last hours of a local day. 11pm on Aug 31
 * in Bogota is already Sep 1 in UTC and in Madrid, so reading it from Madrid
 * used to take it out of August's total and out of the budget period that had
 * already counted it.
 */
import request from "supertest";

import app from "../../app";
import { TransactionModel } from "../../infrastructure/models/TransactionModel";
import { connect, disconnect, dropDatabase } from "./support";

const ACCOUNT_ID = "01940000-0000-7000-8000-c00000000001";
const TX_ID = "01940000-0000-7000-8000-c00000000002";
const BUDGET_ID = "01940000-0000-7000-8000-c00000000003";
const LEGACY_ID = "01940000-0000-7000-8000-c00000000004";
const AMOUNT = 40_000;
const LEGACY_AMOUNT = 11_000;

// 11pm on Aug 31 in Bogota (UTC-5).
const LATE_NIGHT = "2026-09-01T04:00:00.000Z";

const AUGUST = {
  // What a client in Bogota asks for: [Aug 1 00:00, Sep 1 00:00) local.
  bogota: { from: "2026-08-01T05:00:00.000Z", to: "2026-09-01T05:00:00.000Z" },
  // The same month asked from Madrid (UTC+2 in August).
  madrid: { from: "2026-07-31T22:00:00.000Z", to: "2026-08-31T22:00:00.000Z" },
};

interface Session {
  token: string;
  userId: string;
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

async function signIn(timezone: string): Promise<Session> {
  const res = await request(app).post("/auth/login").send({
    email: "zone@accounting.test",
    password: "Offline!2026",
  });
  expect(res.status).toBe(200);
  expect(res.body.user.timezone).toBe(timezone);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function august(session: Session, window: { from: string; to: string }) {
  const spending = await as(
    session,
    request(app).get(
      `/stats/spending?groupBy=day&type=EXPENSE&from=${window.from}&to=${window.to}`,
    ),
  );
  expect(spending.status).toBe(200);
  const list = await as(
    session,
    request(app).get(`/transactions?from=${window.from}&to=${window.to}`),
  );
  expect(list.status).toBe(200);
  const budgets = await as(
    session,
    request(app).get(`/budgets?reference=2026-08-15T12:00:00.000Z`),
  );
  expect(budgets.status).toBe(200);
  return {
    total: spending.body.total as number,
    buckets: spending.body.buckets as { key: string; total: number }[],
    listed: (list.body.data as { id: string }[]).map((row) => row.id),
    spent: (budgets.body.data as { id: string; spent: number }[]).find(
      (row) => row.id === BUDGET_ID,
    )?.spent,
  };
}

describe("the accounting day survives a change of timezone", () => {
  let session: Session;

  beforeAll(async () => {
    await connect();
    await dropDatabase();

    const registered = await request(app).post("/auth/register").send({
      name: "Zone tester",
      email: "zone@accounting.test",
      password: "Offline!2026",
      timezone: "America/Bogota",
    });
    expect(registered.status).toBe(201);
    session = {
      token: registered.body.accessToken,
      userId: registered.body.user.id,
    };

    expect(
      (
        await as(
          session,
          request(app).post("/accounts").send({
            id: ACCOUNT_ID,
            name: "Bancolombia",
            type: "ACCOUNT",
            balance: 1_000_000,
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await as(
          session,
          request(app).post("/budgets").send({
            id: BUDGET_ID,
            name: "Monthly budget",
            color: "INDIGO",
            categoryIds: [],
            type: "EXPENSE",
            periodType: "MONTHLY",
            amount: 2_000_000,
            // A budget created today does not apply to a past month otherwise.
            effectiveFrom: "2026-01-01T05:00:00.000Z",
          }),
        )
      ).status,
    ).toBe(201);
    const created = await as(
      session,
      request(app).post("/transactions").send({
        id: TX_ID,
        type: "EXPENSE",
        amount: AMOUNT,
        date: LATE_NIGHT,
        fromAccountId: ACCOUNT_ID,
      }),
    );
    expect(created.status).toBe(201);
    expect(created.body.dayKey).toBe("2026-08-31");
  }, 30_000);

  afterAll(async () => {
    await disconnect();
  });

  it("counts the late-night expense in August from the zone it was written in", async () => {
    const seen = await august(session, AUGUST.bogota);
    expect(seen.total).toBe(AMOUNT);
    expect(seen.buckets).toEqual([
      { key: "2026-08-31", total: AMOUNT, count: 1, avg: AMOUNT },
    ]);
    expect(seen.listed).toEqual([TX_ID]);
    expect(seen.spent).toBe(AMOUNT);
  });

  it("keeps counting a row written before the field existed, by its instant", async () => {
    // A legacy row: written by the API, then stripped of the field. `db:backfill-day-key` fills it.
    const created = await as(
      session,
      request(app).post("/transactions").send({
        id: LEGACY_ID,
        type: "EXPENSE",
        amount: LEGACY_AMOUNT,
        date: "2026-08-15T17:00:00.000Z",
        fromAccountId: ACCOUNT_ID,
      }),
    );
    expect(created.status).toBe(201);
    await TransactionModel.updateOne(
      { _id: LEGACY_ID },
      { $unset: { dayKey: 1 } },
      { timestamps: false },
    );
    expect(
      (await TransactionModel.findById(LEGACY_ID).lean())?.dayKey,
    ).toBeUndefined();

    const seen = await august(session, AUGUST.bogota);
    expect(seen.total).toBe(AMOUNT + LEGACY_AMOUNT);
    expect(seen.listed).toContain(LEGACY_ID);
    expect(seen.spent).toBe(AMOUNT + LEGACY_AMOUNT);
    // Its bucket is still derived from the instant, in the zone of the account.
    expect(seen.buckets.map((bucket) => bucket.key)).toEqual([
      "2026-08-15",
      "2026-08-31",
    ]);

    await TransactionModel.deleteOne({ _id: LEGACY_ID });
  });

  it("still counts it there after the account moves to Madrid", async () => {
    const before = await august(session, AUGUST.bogota);
    const moved = await as(
      session,
      request(app)
        .put(`/users/${session.userId}`)
        .send({ timezone: "Europe/Madrid" }),
    );
    expect(moved.status).toBe(200);
    // The zone rides in the access token, so the new one starts a new session.
    const inMadrid = await signIn("Europe/Madrid");

    const after = await august(inMadrid, AUGUST.madrid);
    expect(after.total).toBe(before.total);
    expect(after.buckets).toEqual(before.buckets);
    expect(after.listed).toEqual(before.listed);
    expect(after.spent).toBe(before.spent);
  });
});
