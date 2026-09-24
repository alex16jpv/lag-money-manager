/**
 * A loan cannot end above zero, and deleting or lowering what was borrowed
 * from it is a write like any other (T-156), against a real mongod.
 *
 * Mocks cannot see it: the cap is a conditional `$inc` on the net an edit
 * leaves on the account, and a refusal has to abort the whole transaction.
 */
import request from "supertest";

import app from "../../app";
import { AccountModel } from "../../infrastructure/models/AccountModel";
import { connect, disconnect, dropDatabase } from "./support";

const uuid = (n: number): string =>
  `01960000-0000-7000-8000-c${String(n).padStart(11, "0")}`;

interface Session {
  token: string;
  userId: string;
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

describe("a loan never ends above zero, whatever the write (T-156)", () => {
  let owner: Session;
  const bank = uuid(20);
  const category = uuid(21);

  const balanceOf = async (id: string): Promise<number> => {
    const res = await as(owner, request(app).get(`/accounts/${id}`));
    expect(res.status).toBe(200);
    return res.body.balance as number;
  };

  const move = async (body: Record<string, unknown>): Promise<void> => {
    const res = await as(
      owner,
      request(app)
        .post("/transactions")
        .send({ date: new Date().toISOString(), ...body }),
    );
    expect(res.status).toBe(201);
  };

  const loanWith = async (
    n: number,
    interest: number,
    paid: number,
  ): Promise<{ loan: string; interest: string; payment: string }> => {
    const ids = { loan: uuid(n), interest: uuid(n + 1), payment: uuid(n + 2) };
    const created = await as(
      owner,
      request(app)
        .post("/accounts")
        .send({
          id: ids.loan,
          name: `Loan ${n}`,
          type: "LOAN",
          balance: -1000,
          borrowedAmount: 5000,
        }),
    );
    expect(created.status).toBe(201);
    await move({
      id: ids.interest,
      type: "EXPENSE",
      amount: interest,
      fromAccountId: ids.loan,
    });
    await move({
      id: ids.payment,
      type: "TRANSFER",
      amount: paid,
      fromAccountId: bank,
      toAccountId: ids.loan,
    });
    return ids;
  };

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    const res = await request(app).post("/auth/register").send({
      name: "Loan tester",
      email: "loan@movements.test",
      password: "Offline!2026",
      currency: "USD",
    });
    expect(res.status).toBe(201);
    owner = { token: res.body.accessToken, userId: res.body.user.id };
    const created = await as(
      owner,
      request(app)
        .post("/accounts")
        .send({ id: bank, name: "Bank", type: "ACCOUNT", balance: 20000 }),
    );
    expect(created.status).toBe(201);
    const tickets = await as(
      owner,
      request(app)
        .post("/categories")
        .send({ id: category, name: "Tickets", type: "EXPENSE" }),
    );
    expect(tickets.status).toBe(201);
  });

  afterAll(disconnect);

  it("refuses to delete what was borrowed once it is paid off, and nothing moves", async () => {
    const { loan, interest } = await loanWith(30, 200, 1200);
    expect(await balanceOf(loan)).toBe(0);

    const removed = await as(
      owner,
      request(app).delete(`/transactions/${interest}`),
    );

    expect(removed.status).toBe(400);
    expect(removed.body.code).toBe("LOAN_OVERPAID");
    expect(await balanceOf(loan)).toBe(0);
    const still = await as(
      owner,
      request(app).get(`/transactions/${interest}`),
    );
    expect(still.status).toBe(200);
  });

  it("refuses to lower it or move it off the loan, which would leave the same credit", async () => {
    const { loan, interest } = await loanWith(40, 200, 1200);

    for (const edit of [{ amount: 100 }, { fromAccountId: bank }]) {
      const res = await as(
        owner,
        request(app).put(`/transactions/${interest}`).send(edit),
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LOAN_OVERPAID");
    }
    expect(await balanceOf(loan)).toBe(0);
    expect(await balanceOf(bank)).toBe(20000 - 1200 - 1200);
  });

  it("takes the fix in the order that keeps it honest: the payment first, then the rest", async () => {
    const { loan, interest, payment } = await loanWith(50, 200, 1200);

    const lowered = await as(
      owner,
      request(app).put(`/transactions/${payment}`).send({ amount: 1000 }),
    );
    expect(lowered.status).toBe(200);
    expect(await balanceOf(loan)).toBe(-200);

    const removed = await as(
      owner,
      request(app).delete(`/transactions/${interest}`),
    );
    expect(removed.status).toBe(200);
    expect(await balanceOf(loan)).toBe(0);
  });

  it("judges an edit by where the loan ends, not by the reversal half-way through it", async () => {
    const { loan, interest } = await loanWith(60, 200, 1100);
    expect(await balanceOf(loan)).toBe(-100);

    const res = await as(
      owner,
      request(app).put(`/transactions/${interest}`).send({ amount: 150 }),
    );

    expect(res.status).toBe(200);
    expect(await balanceOf(loan)).toBe(-50);
  });
  const newLoan = async (n: number, balance: number): Promise<string> => {
    const id = uuid(n);
    const created = await as(
      owner,
      request(app)
        .post("/accounts")
        .send({
          id,
          name: `Loan ${n}`,
          type: "LOAN",
          balance,
          borrowedAmount: 5000,
        }),
    );
    expect(created.status).toBe(201);
    return id;
  };

  const groupWithSomebody = async (
    n: number,
  ): Promise<{ contactId: string; groupId: string }> => {
    const contact = await as(
      owner,
      request(app)
        .post("/contacts")
        .send({ name: `Ana ${n}` }),
    );
    expect(contact.status).toBe(201);
    const group = await as(
      owner,
      request(app)
        .post("/shared-groups")
        .send({ name: `Trip ${n}`, contactIds: [contact.body.id] }),
    );
    expect(group.status).toBe(201);
    const theirs = await as(
      owner,
      request(app).post(`/shared-groups/${group.body.id}/expenses`).send({
        description: "Tickets",
        date: "2026-08-12T18:00:00.000Z",
        amount: 1000,
        paidByContactId: contact.body.id,
      }),
    );
    expect(theirs.status).toBe(201);
    return { contactId: contact.body.id, groupId: group.body.id };
  };

  it("refuses to undo a payment made from a loan paid off since [settle-up]", async () => {
    const loan = await newLoan(70, -1000);
    const { contactId } = await groupWithSomebody(70);
    const paid = await as(
      owner,
      request(app).post("/settlements").send({
        contactId,
        date: "2026-08-25T18:00:00.000Z",
        paid: 500,
        accountId: loan,
        categoryId: category,
      }),
    );
    expect(paid.status).toBe(201);
    await move({
      type: "TRANSFER",
      amount: 1500,
      fromAccountId: bank,
      toAccountId: loan,
    });
    expect(await balanceOf(loan)).toBe(0);

    const undone = await as(
      owner,
      request(app).delete(`/settlements/${paid.body.settlement.id}`),
    );

    expect(undone.status).toBe(400);
    expect(undone.body.code).toBe("LOAN_OVERPAID");
    expect(await balanceOf(loan)).toBe(0);
  });

  it("caps a settle-up on the net it leaves, not on its first movement", async () => {
    const loan = await newLoan(80, -100);
    const { contactId, groupId } = await groupWithSomebody(80);
    const yours = await as(
      owner,
      request(app).post("/transactions").send({
        type: "EXPENSE",
        amount: 600,
        date: "2026-08-10T18:00:00.000Z",
        categoryId: category,
        fromAccountId: bank,
      }),
    );
    expect(yours.status).toBe(201);
    const shared = await as(
      owner,
      request(app)
        .post(`/shared-groups/${groupId}/expenses`)
        .send({ transactionId: yours.body.id }),
    );
    expect(shared.status).toBe(201);

    const both = await as(
      owner,
      request(app).post("/settlements").send({
        contactId,
        date: "2026-08-25T18:00:00.000Z",
        collected: 300,
        paid: 500,
        accountId: loan,
        categoryId: category,
      }),
    );

    expect(both.status).toBe(201);
    expect(await balanceOf(loan)).toBe(-300);

    const undone = await as(
      owner,
      request(app).delete(`/settlements/${both.body.settlement.id}`),
    );
    expect(undone.status).toBe(200);
    expect(await balanceOf(loan)).toBe(-100);
  });

  it("lets a loan already above zero be brought down, and nothing take it higher", async () => {
    const loan = await newLoan(90, -100);
    await move({
      id: uuid(91),
      type: "EXPENSE",
      amount: 200,
      fromAccountId: loan,
    });
    await move({
      id: uuid(92),
      type: "TRANSFER",
      amount: 300,
      fromAccountId: bank,
      toAccountId: loan,
    });
    expect(await balanceOf(loan)).toBe(0);
    // A loan left above zero before T-156: no endpoint can put one there any more.
    await AccountModel.updateOne({ _id: loan }, { $set: { balance: 10000 } });

    const lowered = await as(
      owner,
      request(app)
        .put(`/transactions/${uuid(92)}`)
        .send({ amount: 250 }),
    );
    expect(lowered.status).toBe(200);
    expect(await balanceOf(loan)).toBe(50);

    const higher = await as(
      owner,
      request(app)
        .put(`/transactions/${uuid(91)}`)
        .send({ amount: 100 }),
    );
    expect(higher.status).toBe(400);
    expect(higher.body.code).toBe("LOAN_OVERPAID");

    const removed = await as(
      owner,
      request(app).delete(`/transactions/${uuid(92)}`),
    );
    expect(removed.status).toBe(200);
    expect(await balanceOf(loan)).toBe(-200);
  });

  it("caps a payment moved from one loan to another on the one it lands on", async () => {
    const first = await newLoan(100, -500);
    const second = await newLoan(101, -200);
    await move({
      id: uuid(102),
      type: "TRANSFER",
      amount: 400,
      fromAccountId: bank,
      toAccountId: first,
    });

    const moved = await as(
      owner,
      request(app)
        .put(`/transactions/${uuid(102)}`)
        .send({ toAccountId: second }),
    );

    expect(moved.status).toBe(400);
    expect(moved.body.code).toBe("LOAN_OVERPAID");
    expect(await balanceOf(first)).toBe(-100);
    expect(await balanceOf(second)).toBe(-200);
  });
});
