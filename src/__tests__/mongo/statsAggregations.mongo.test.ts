// What a mock cannot reach: the controller's parsing, and Mongo's own grouping and order.
import request from "supertest";

import app from "../../app";
import { TransactionModel } from "../../infrastructure/models/TransactionModel";
import { connect, disconnect, dropDatabase } from "./support";

interface Bucket {
  key: string;
  total: number;
  count: number;
  avg: number;
  splits?: { key: string; total: number }[];
}

interface Report {
  groupBy: string;
  splitBy: string | null;
  buckets: Bucket[];
  total: number;
}

const MONTHS = ["2026-06", "2026-07", "2026-08"];

describe("spending aggregations against mongod", () => {
  let token: string;
  let userId: string;
  let wallet: string;
  let card: string;
  let food: string;
  let transport: string;
  let other: string;

  const spending = async (query: string): Promise<Report> => {
    const res = await request(app)
      .get(`/stats/spending?${query}`)
      .set("Authorization", `Bearer ${token}`);
    expect([query, res.status]).toEqual([query, 200]);
    return res.body as Report;
  };

  const refused = async (query: string): Promise<void> => {
    const res = await request(app)
      .get(`/stats/spending?${query}`)
      .set("Authorization", `Bearer ${token}`);
    expect([query, res.status, res.body.code]).toEqual([
      query,
      400,
      "VALIDATION",
    ]);
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();

    const registered = await request(app).post("/auth/register").send({
      name: "Stats",
      email: "stats@aggregations.test",
      password: "Offline!2026",
      timezone: "America/Bogota",
    });
    expect(registered.status).toBe(201);
    token = registered.body.accessToken;
    userId = registered.body.user.id;

    const as = (req: request.Test): request.Test =>
      req.set("Authorization", `Bearer ${token}`);

    for (const name of ["Wallet", "Card"]) {
      const res = await as(
        request(app).post("/accounts").send({ name, type: "CASH", balance: 0 }),
      );
      expect(res.status).toBe(201);
    }
    const accounts = await as(request(app).get("/accounts?limit=100"));
    wallet = accounts.body.data[0].id;
    card = accounts.body.data[1].id;

    const categories = await as(
      request(app).get("/categories?limit=100&type=EXPENSE"),
    );
    food = categories.body.data[0].id;
    transport = categories.body.data[1].id;
    other = categories.body.data[2].id;

    // One expense per month per category per account: every bucket below is a known number.
    for (const month of MONTHS) {
      for (const [categoryId, from, amount] of [
        [food, wallet, 100],
        [transport, card, 10],
      ] as const) {
        const res = await as(
          request(app)
            .post("/transactions")
            .send({
              type: "EXPENSE",
              amount,
              date: `${month}-15T12:00:00-05:00`,
              categoryId,
              fromAccountId: from,
            }),
        );
        expect(res.status).toBe(201);
      }
    }
  });

  afterAll(async () => {
    await dropDatabase();
    await disconnect();
  });

  const WHOLE_RANGE =
    "from=2026-06-01T00:00:00-05:00&to=2026-09-01T00:00:00-05:00";

  it("groups three months in one request instead of three", async () => {
    const report = await spending(`groupBy=month&${WHOLE_RANGE}`);

    expect(report.groupBy).toBe("month");
    expect(report.splitBy).toBeNull();
    expect(report.buckets.map((b) => [b.key, b.total])).toEqual([
      ["2026-06", 110],
      ["2026-07", 110],
      ["2026-08", 110],
    ]);
    expect(report.total).toBe(330);
  });

  it("groups by the account the money left", async () => {
    const report = await spending(`groupBy=account&${WHOLE_RANGE}`);

    expect(report.buckets.map((b) => [b.key, b.total])).toEqual([
      [wallet, 300],
      [card, 30],
    ]);
  });

  // An increase-only ADJUSTMENT has no `fromAccountId` and used to land in `unassigned`.
  it("buckets a balance increase under the account it landed in", async () => {
    const res = await request(app)
      .post("/transactions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "ADJUSTMENT",
        amount: 500,
        date: "2026-04-10T12:00:00-05:00",
        toAccountId: card,
      });
    expect(res.status).toBe(201);
    const april = "from=2026-04-01T00:00:00-05:00&to=2026-05-01T00:00:00-05:00";

    const report = await spending(`groupBy=account&type=ADJUSTMENT&${april}`);

    expect(report.buckets).toEqual([
      { key: card, total: 500, count: 1, avg: 500 },
    ]);
  });

  it("narrows to the categories a budget covers", async () => {
    const report = await spending(
      `groupBy=day&categoryIds=${transport}&${WHOLE_RANGE}`,
    );

    expect(report.buckets.map((b) => [b.key, b.total])).toEqual([
      ["2026-06-15", 10],
      ["2026-07-15", 10],
      ["2026-08-15", 10],
    ]);
    expect(report.total).toBe(30);
  });

  // 330 is also the total with no filter at all, so the third category is what makes this bite.
  it("takes several categories as one list", async () => {
    const report = await spending(
      `groupBy=month&categoryIds=${food},${transport}&${WHOLE_RANGE}`,
    );
    const narrower = await spending(
      `groupBy=month&categoryIds=${food},${other}&${WHOLE_RANGE}`,
    );

    expect(report.total).toBe(330);
    expect(narrower.total).toBe(300);
    expect(narrower.buckets.map((b) => b.total)).toEqual([100, 100, 100]);
  });

  it("splits each month by category without a second request", async () => {
    const report = await spending(
      `groupBy=month&splitBy=category&${WHOLE_RANGE}`,
    );

    expect(report.splitBy).toBe("category");
    for (const bucket of report.buckets) {
      const splits = bucket.splits ?? [];
      expect(splits).toEqual([
        { key: food, total: 100, count: 1, avg: 100 },
        { key: transport, total: 10, count: 1, avg: 10 },
      ]);
      // Splits never overlap, so unlike tags they add up to the bucket itself.
      expect(splits.reduce((acc, s) => acc + s.total, 0)).toBe(bucket.total);
    }
  });

  it("leaves the splits out when nobody asked for them", async () => {
    const report = await spending(`groupBy=month&${WHOLE_RANGE}`);

    expect(report.buckets.every((b) => b.splits === undefined)).toBe(true);
  });

  it.each([
    ["splitBy repeating the grouping", "groupBy=category&splitBy=category"],
    ["splitBy with no groupBy, which is category", "splitBy=category"],
    ["splitBy over the tag unwind", "groupBy=tag&splitBy=category"],
    ["splitBy over a day grouping", "groupBy=day&splitBy=category"],
    ["a groupBy it does not have", "groupBy=description"],
    ["a categoryIds that is not a list of ids", "categoryIds=food,drink"],
    ["an empty categoryIds", "categoryIds="],
  ])("refuses %s", async (_label, query) => {
    await refused(`${query}&${WHOLE_RANGE}`);
  });

  // Inserted raw because the API cannot write a row without a `dayKey` any more.
  it("files a row with no frozen day under the month its instant falls in", async () => {
    const id = "01950000-0000-7000-8000-00000000f001";
    await TransactionModel.collection.insertOne({
      _id: id,
      userId,
      type: "EXPENSE",
      amount: 5000,
      date: new Date("2026-07-01T02:00:00Z"),
      dayKey: null,
      categoryId: food,
      fromAccountId: wallet,
      toAccountId: null,
      tags: [],
      pendingDetails: false,
      source: "MANUAL",
      currency: "COP",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const months = await spending(
      "groupBy=month&from=2026-06-01T00:00:00-05:00&to=2026-09-01T00:00:00-05:00",
    );
    const days = await spending(
      "groupBy=day&from=2026-06-01T00:00:00-05:00&to=2026-09-01T00:00:00-05:00",
    );

    // 02:00Z on 1 July is still 30 June in Bogota: the month and the day have to agree.
    expect(months.buckets.find((b) => b.key === "2026-06")?.total).toBe(160);
    expect(days.buckets.find((d) => d.key === "2026-06-30")?.total).toBe(50);
    await TransactionModel.deleteOne({ _id: id });
  });

  // No scenario may carry a tie, so the rule the ranked buckets obey lives here.
  it("breaks a tie between two buckets by key, ascending", async () => {
    for (const categoryId of [transport, other]) {
      const res = await request(app)
        .post("/transactions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          type: "EXPENSE",
          amount: 55,
          date: "2026-05-10T12:00:00-05:00",
          categoryId,
          fromAccountId: wallet,
        });
      expect(res.status).toBe(201);
    }
    const may = "from=2026-05-01T00:00:00-05:00&to=2026-06-01T00:00:00-05:00";

    const ranked = await spending(`groupBy=category&${may}`);
    const split = await spending(`groupBy=month&splitBy=category&${may}`);
    const ascending = [transport, other].sort();

    expect(ranked.buckets.map((b) => [b.key, b.total])).toEqual([
      [ascending[0], 55],
      [ascending[1], 55],
    ]);
    expect(split.buckets[0].splits?.map((s) => s.key)).toEqual(ascending);
  });

  it("refuses more categories than a budget can hold", async () => {
    const twentyOne = Array.from(
      { length: 21 },
      (_, i) => `01950000-0000-7000-8000-0000000${String(i).padStart(5, "0")}`,
    ).join(",");

    await refused(`categoryIds=${twentyOne}&${WHOLE_RANGE}`);
  });
});
