/**
 * What a movement may do to the type of account it touches (T-93), against a
 * real mongod and over HTTP.
 *
 * Mocks cannot see the half that matters: the loan cap is a conditional `$inc`
 * decided by the database, and a refusal has to abort the Mongo transaction so
 * neither side of a transfer keeps a cent.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

const uuid = (n: number): string =>
  `01960000-0000-7000-8000-b${String(n).padStart(11, "0")}`;

interface Session {
  token: string;
  userId: string;
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

describe("what a movement may do to an account", () => {
  let owner: Session;
  const bank = uuid(1);
  const card = uuid(2);
  const loan = uuid(3);

  const balanceOf = async (id: string): Promise<number> => {
    const res = await as(owner, request(app).get(`/accounts/${id}`));
    expect(res.status).toBe(200);
    return res.body.balance as number;
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const res = await request(app).post("/auth/register").send({
      name: "Rules tester",
      email: "rules@movements.test",
      password: "Offline!2026",
      currency: "USD",
    });
    expect(res.status).toBe(201);
    owner = { token: res.body.accessToken, userId: res.body.user.id };

    for (const account of [
      { id: bank, name: "Bank", type: "ACCOUNT", balance: 20000 },
      {
        id: card,
        name: "Visa",
        type: "CARD",
        balance: -1245.9,
        creditLimit: 4000,
      },
      {
        id: loan,
        name: "Car loan",
        type: "LOAN",
        balance: -8400,
        borrowedAmount: 12000,
      },
    ]) {
      const created = await as(
        owner,
        request(app).post("/accounts").send(account),
      );
      expect(created.status).toBe(201);
    }
  });

  afterAll(disconnect);

  it("refuses an income on a card and leaves the balance where it was", async () => {
    const before = await balanceOf(card);

    const res = await as(
      owner,
      request(app).post("/transactions").send({
        type: "INCOME",
        amount: 600,
        date: new Date().toISOString(),
        toAccountId: card,
      }),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INCOME_ON_DEBT_ACCOUNT");
    expect(await balanceOf(card)).toBe(before);
  });

  it("takes the same money as a transfer, which is what paying a card is", async () => {
    const res = await as(
      owner,
      request(app).post("/transactions").send({
        type: "TRANSFER",
        amount: 600,
        date: new Date().toISOString(),
        fromAccountId: bank,
        toAccountId: card,
      }),
    );

    expect(res.status).toBe(201);
    expect(await balanceOf(card)).toBe(-645.9);
    expect(await balanceOf(bank)).toBe(19400);
  });

  it("refuses to pay a loan more than it owes, and neither side moves", async () => {
    const loanBefore = await balanceOf(loan);
    const bankBefore = await balanceOf(bank);

    const res = await as(
      owner,
      request(app)
        .post("/transactions")
        .send({
          type: "TRANSFER",
          amount: loanBefore * -1 + 0.01,
          date: new Date().toISOString(),
          fromAccountId: bank,
          toAccountId: loan,
        }),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOAN_OVERPAID");
    expect(await balanceOf(loan)).toBe(loanBefore);
    expect(await balanceOf(bank)).toBe(bankBefore);
  });

  it("takes the last cent that clears it, and refuses the one after", async () => {
    const owed = (await balanceOf(loan)) * -1;

    const paid = await as(
      owner,
      request(app).post("/transactions").send({
        type: "TRANSFER",
        amount: owed,
        date: new Date().toISOString(),
        fromAccountId: bank,
        toAccountId: loan,
      }),
    );
    expect(paid.status).toBe(201);
    expect(await balanceOf(loan)).toBe(0);

    const again = await as(
      owner,
      request(app).post("/transactions").send({
        type: "ADJUSTMENT",
        amount: 0.01,
        date: new Date().toISOString(),
        toAccountId: loan,
      }),
    );
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("LOAN_OVERPAID");
    expect(await balanceOf(loan)).toBe(0);
  });

  it("still lets a loan that is finished be undone: a reversal is never capped", async () => {
    const list = await as(
      owner,
      request(app).get(`/transactions?accountId=${loan}&limit=50`),
    );
    expect(list.status).toBe(200);
    const payment = (list.body.data as { id: string; type: string }[]).find(
      (row) => row.type === "TRANSFER",
    );
    expect(payment).toBeDefined();

    const removed = await as(
      owner,
      request(app).delete(`/transactions/${payment?.id}`),
    );
    expect(removed.status).toBe(200);
    expect(await balanceOf(loan)).toBeLessThan(0);
  });
});
