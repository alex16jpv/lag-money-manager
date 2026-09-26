import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

describe("the listing's summary against mongod", () => {
  let token: string;
  let bank: string;
  let savings: string;

  const as = (req: request.Test): request.Test =>
    req.set("Authorization", `Bearer ${token}`);

  const summaryOf = async (
    query: string,
  ): Promise<{ total: number; summary: unknown }> => {
    const res = await as(
      request(app).get(`/transactions?${query}&includeSummary=true&limit=1`),
    );
    expect(res.status).toBe(200);
    return { total: res.body.pagination.total, summary: res.body.summary };
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const registered = await request(app).post("/auth/register").send({
      name: "Sums",
      email: "sums@summary.test",
      password: "Offline!2026",
    });
    expect(registered.status).toBe(201);
    token = registered.body.accessToken;

    const account = async (name: string, type: string): Promise<string> => {
      const res = await as(
        request(app)
          .post("/accounts")
          .send({ name, type, balance: 1_000_000, color: "BLUE" }),
      );
      expect(res.status).toBe(201);
      return res.body.id;
    };
    bank = await account("Bank", "ACCOUNT");
    savings = await account("Savings", "SAVINGS");

    const date = "2026-08-10T12:00:00.000Z";
    for (const body of [
      { type: "EXPENSE", amount: 12_500, fromAccountId: bank },
      { type: "EXPENSE", amount: 15_400, fromAccountId: bank },
      { type: "EXPENSE", amount: 7_000, fromAccountId: savings },
      { type: "INCOME", amount: 1_200_000, toAccountId: bank },
      {
        type: "TRANSFER",
        amount: 50_000,
        fromAccountId: bank,
        toAccountId: savings,
      },
      { type: "ADJUSTMENT", amount: 3_000, toAccountId: bank },
      { type: "ADJUSTMENT", amount: 800, fromAccountId: bank },
    ]) {
      const res = await as(
        request(app)
          .post("/transactions")
          .send({ ...body, date }),
      );
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await dropDatabase();
    await disconnect();
  });

  it("sums an account's expenses and income apart, and its transfer and adjustments in neither", async () => {
    await expect(summaryOf(`accountId=${bank}`)).resolves.toEqual({
      total: 6,
      summary: { expense: 27_900, income: 1_200_000 },
    });
  });

  it("answers a type that has no direction with two zeros, not with its amounts", async () => {
    await expect(summaryOf("type=TRANSFER")).resolves.toEqual({
      total: 1,
      summary: { expense: 0, income: 0 },
    });
  });

  it("sums every account's rows when no account is named", async () => {
    await expect(summaryOf("from=2026-08-01T00:00:00.000Z")).resolves.toEqual({
      total: 7,
      summary: { expense: 34_900, income: 1_200_000 },
    });
  });
});
