jest.mock("../../shared/unitOfWork", () => ({
  withTransaction: jest.fn((fn: (session: unknown) => unknown) =>
    fn("test-session"),
  ),
}));

import { SharedExpenseService } from "../../app/services/SharedExpenseService";
import { SharedLedgerService } from "../../app/services/SharedLedgerService";
import { SharedExpense } from "../../domain/entities/SharedExpense";
import { SharedGroup } from "../../domain/entities/SharedGroup";
import { Transaction } from "../../domain/entities/Transaction";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ISharedSettlementRepository } from "../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";

const userId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const otherUserId = "019576a0-d7b6-7d6d-af6a-2b7545f5acff";
const groupId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";
const expenseId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac72";
const ana = "019576a0-d7b6-7d6d-af6a-2b7545f5aca1";
const beto = "019576a0-d7b6-7d6d-af6a-2b7545f5aca2";
const date = new Date("2026-09-15T18:00:00.000Z");

const makeGroup = (props: Partial<SharedGroup> = {}): SharedGroup =>
  new SharedGroup({
    id: groupId,
    name: "Night out",
    userId,
    currency: "COP",
    participants: [
      { contactId: null },
      { contactId: ana },
      { contactId: beto },
    ],
    defaultSplit: { mode: "EQUAL", shares: [] },
    updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    ...props,
  });

const groupRepo = (): jest.Mocked<ISharedGroupRepository> => ({
  getManyIncludingArchived: jest.fn().mockResolvedValue([]),
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn().mockResolvedValue(makeGroup()),
  changesSince: jest.fn().mockResolvedValue([]),
  getOwnById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  restore: jest.fn(),
});

const expenseRepo = (): jest.Mocked<ISharedExpenseRepository> => ({
  allInGroups: jest.fn().mockResolvedValue([]),
  changesInGroups: jest.fn().mockResolvedValue([]),
  getAll: jest.fn(),
  getAllByGroup: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingDeleted: jest.fn(),
  getOwnById: jest.fn(),
  listByGroup: jest.fn().mockResolvedValue([]),
  listByCounterparty: jest.fn().mockResolvedValue([]),
  changesSince: jest.fn().mockResolvedValue([]),
  countSharesOfContact: jest.fn().mockResolvedValue(0),
  totalsByGroup: jest.fn().mockResolvedValue([]),
  replaceSplits: jest.fn().mockResolvedValue(undefined),
  create: jest.fn().mockImplementation(async (e) => e as SharedExpense),
  update: jest.fn(),
  delete: jest.fn(),
});

const transactionRepo = (): jest.Mocked<ITransactionRepository> => ({
  getImported: jest.fn().mockResolvedValue(null),
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getOwnById: jest.fn(),
  isDeleted: jest.fn().mockResolvedValue(false),
  getBySharedExpenseId: jest.fn().mockResolvedValue(null),
  listBySharedExpenseIds: jest.fn().mockResolvedValue([]),
  listBySettlementId: jest.fn().mockResolvedValue([]),
  applySharedChange: jest.fn(),
  changesSince: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  aggregateSpending: jest.fn(),
  listTags: jest.fn().mockResolvedValue([]),
  countByCategory: jest.fn().mockResolvedValue(0),
  sumAmountsByCategory: jest.fn(),
  sumAmounts: jest.fn().mockResolvedValue(0),
});

const settlementRepo = (): jest.Mocked<ISharedSettlementRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getOwnById: jest.fn(),
  listByCounterparty: jest.fn().mockResolvedValue([]),
  changesSince: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

describe("SharedExpenseService", () => {
  let service: SharedExpenseService;
  let expenses: jest.Mocked<ISharedExpenseRepository>;
  let groups: jest.Mocked<ISharedGroupRepository>;
  let transactions: jest.Mocked<ITransactionRepository>;
  let settlements: jest.Mocked<ISharedSettlementRepository>;

  beforeEach(() => {
    expenses = expenseRepo();
    groups = groupRepo();
    transactions = transactionRepo();
    settlements = settlementRepo();
    service = new SharedExpenseService(
      expenses,
      groups,
      transactions,
      new SharedLedgerService(expenses, settlements, transactions),
    );
  });

  const create = (body: Record<string, unknown> = {}) =>
    service.createExpense({
      groupId,
      description: "Dinner",
      date,
      amount: 90000,
      userId,
      ...body,
    });

  describe("creating one", () => {
    it("inherits the group's split without being asked", async () => {
      const created = await create();

      expect(created.customSplit).toBe(false);
      expect(created.split.mode).toBe("EQUAL");
      expect(created.split.shares.map((s) => s.amount)).toEqual([
        30000, 30000, 30000,
      ]);
    });

    it("inherits a percentage default with each person's figure", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({
          defaultSplit: {
            mode: "PERCENT",
            shares: [
              { contactId: null, percent: 50 },
              { contactId: ana, percent: 30 },
              { contactId: beto, percent: 20 },
            ],
          },
        }),
      );

      const created = await create({ amount: 100000 });

      expect(created.split.shares.map((s) => s.amount)).toEqual([
        50000, 30000, 20000,
      ]);
    });

    it("marks an expense that carries its own split", async () => {
      const created = await create({
        amount: 100000,
        split: {
          mode: "EXACT",
          shares: [
            { party: "USER", fixedAmount: 60000 },
            { party: "CONTACT", contactId: ana, fixedAmount: 40000 },
          ],
        },
      });

      expect(created.customSplit).toBe(true);
      expect(created.split.shares).toHaveLength(2);
    });

    it("lets a split leave somebody in the group out of one expense", async () => {
      const created = await create({
        split: {
          mode: "EQUAL",
          shares: [{ party: "USER" }, { party: "CONTACT", contactId: ana }],
        },
      });

      expect(created.split.shares.map((s) => s.amount)).toEqual([45000, 45000]);
    });

    it("weighs a block of guests and leaves the group the size it is", async () => {
      const created = await create({
        amount: 230000,
        split: {
          mode: "EQUAL",
          guests: { count: 20, name: "The office" },
          shares: [
            { party: "USER" },
            { party: "CONTACT", contactId: ana },
            { party: "CONTACT", contactId: beto },
            { party: "GUESTS" },
          ],
        },
      });

      expect(created.split.guests).toEqual({ count: 20, name: "The office" });
      expect(created.split.shares.map((s) => s.amount)).toEqual([
        10000, 10000, 10000, 200000,
      ]);
    });

    it("refuses a guest share with no head count above it", async () => {
      await expect(
        create({
          split: { mode: "EQUAL", shares: [{ party: "GUESTS" }] },
        }),
      ).rejects.toMatchObject({ code: "SPLIT_INVALID" });
    });

    it("refuses a share for somebody who is not in the group", async () => {
      await expect(
        create({
          split: {
            mode: "EQUAL",
            shares: [
              { party: "USER" },
              { party: "CONTACT", contactId: otherUserId },
            ],
          },
        }),
      ).rejects.toMatchObject({ code: "PARTICIPANT_NOT_IN_GROUP" });
    });

    it("refuses a payer who is not in the group", async () => {
      await expect(
        create({ paidByContactId: otherUserId }),
      ).rejects.toMatchObject({ code: "PARTICIPANT_NOT_IN_GROUP" });
    });

    it("gives the odd peso to the other payer when the line is theirs", async () => {
      const created = await create({ amount: 100000, paidByContactId: ana });

      const shares = created.split.shares;
      expect(shares.find((s) => s.contactId === ana)?.amount).toBe(33334);
      expect(shares.filter((s) => s.amount === 33333)).toHaveLength(2);
    });

    it("refuses decimals in a currency that has none", async () => {
      await expect(create({ amount: 90000.5 })).rejects.toMatchObject({
        code: "AMOUNT_PRECISION",
      });
    });

    it("refuses a date more than a day ahead", async () => {
      await expect(
        create({ date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }),
      ).rejects.toMatchObject({ code: "FUTURE_DATE" });
    });

    it("refuses an archived group", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ archivedAt: new Date() }),
      );

      await expect(create()).rejects.toMatchObject({
        code: "RESOURCE_ARCHIVED",
      });
    });

    it("answers 404 for somebody else's group", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ userId: otherUserId }),
      );

      await expect(create()).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("an expense that is a movement of yours [T-115]", () => {
    const txId = "019576a0-d7b6-7d6d-af6a-2b7545f5acb1";
    const accountId = "019576a0-d7b6-7d6d-af6a-2b7545f5acb2";

    const movement = (props: Partial<Transaction> = {}): Transaction =>
      new Transaction({
        id: txId,
        type: "EXPENSE",
        amount: 120000,
        date: new Date("2026-08-12T18:00:00.000Z"),
        description: "Corner store",
        fromAccountId: accountId,
        userId,
        currency: "COP",
        ...props,
      });

    const splitTheMovement = (): Promise<SharedExpense> =>
      service.createExpense({ groupId, userId, transactionId: txId });

    beforeEach(() => {
      transactions.getById.mockResolvedValue(movement());
    });

    it("takes the figures from the movement and links it, moving no money", async () => {
      const created = await splitTheMovement();

      expect(created.amount).toBe(120000);
      expect(created.date).toEqual(new Date("2026-08-12T18:00:00.000Z"));
      expect(created.description).toBe("Corner store");
      expect(transactions.applySharedChange).toHaveBeenCalledWith(
        txId,
        userId,
        {
          sharedExpenseId: created.id,
          sharedGroupId: groupId,
          countsAsYours: 120000,
        },
        expect.objectContaining({ reason: "SPLIT", countsAsYours: 120000 }),
        "test-session",
      );
    });

    it("refuses a movement that is already in a group", async () => {
      transactions.getById.mockResolvedValue(
        movement({
          sharedExpenseId: "019576a0-d7b6-7d6d-af6a-2b7545f5acb3",
          sharedGroupId: "019576a0-d7b6-7d6d-af6a-2b7545f5acb4",
        }),
      );

      await expect(splitTheMovement()).rejects.toMatchObject({
        code: "TRANSACTION_ALREADY_SHARED",
      });
      expect(expenses.create).not.toHaveBeenCalled();
    });

    it("refuses anything that is not an expense", async () => {
      transactions.getById.mockResolvedValue(
        movement({
          type: "INCOME",
          fromAccountId: null,
          toAccountId: accountId,
        }),
      );

      await expect(splitTheMovement()).rejects.toMatchObject({
        code: "TRANSACTION_NOT_SPLITTABLE",
      });
    });

    it("refuses a movement in another currency than the group", async () => {
      transactions.getById.mockResolvedValue(movement({ currency: "EUR" }));

      await expect(splitTheMovement()).rejects.toMatchObject({
        code: "CURRENCY_MISMATCH",
      });
    });

    it("answers 404 for a movement of somebody else's", async () => {
      transactions.getById.mockResolvedValue(movement({ userId: otherUserId }));

      await expect(splitTheMovement()).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("states amount and date itself when no movement is named", async () => {
      await create();

      expect(transactions.applySharedChange).not.toHaveBeenCalled();
    });
  });

  describe("editing one", () => {
    const stored = (props: Partial<SharedExpense> = {}): SharedExpense =>
      new SharedExpense({
        id: expenseId,
        groupId,
        description: "Dinner",
        date,
        amount: 90000,
        userId,
        currency: "COP",
        customSplit: false,
        split: {
          mode: "EQUAL",
          guests: null,
          shares: [
            {
              party: "USER",
              contactId: null,
              percent: null,
              fixedAmount: null,
              amount: 30000,
              collected: 0,
            },
            {
              party: "CONTACT",
              contactId: ana,
              percent: null,
              fixedAmount: null,
              amount: 30000,
              collected: 0,
            },
            {
              party: "CONTACT",
              contactId: beto,
              percent: null,
              fixedAmount: null,
              amount: 30000,
              collected: 0,
            },
          ],
        },
        updatedAt: new Date("2026-09-20T10:00:00.000Z"),
        ...props,
      });

    beforeEach(() => {
      expenses.update.mockImplementation(
        async (_id, write) =>
          new SharedExpense({
            ...stored(),
            ...(write as Partial<SharedExpense>),
          }),
      );
    });

    it("splits the shares again when the amount changes", async () => {
      expenses.getByIdIncludingDeleted.mockResolvedValue(stored());

      const updated = await service.updateExpense(
        expenseId,
        { amount: 120000 },
        userId,
      );

      expect(updated.split.shares.map((s) => s.amount)).toEqual([
        40000, 40000, 40000,
      ]);
    });

    it("moves the odd peso when who paid changes", async () => {
      expenses.getByIdIncludingDeleted.mockResolvedValue(
        stored({ amount: 100000 }),
      );

      const updated = await service.updateExpense(
        expenseId,
        { paidByContactId: ana },
        userId,
      );

      expect(
        updated.split.shares.find((s) => s.contactId === ana)?.amount,
      ).toBe(33334);
    });

    it("re-resolves a custom percentage split when only the amount moves", async () => {
      expenses.getByIdIncludingDeleted.mockResolvedValue(
        stored({
          customSplit: true,
          split: {
            mode: "PERCENT",
            guests: null,
            shares: [
              {
                party: "USER",
                contactId: null,
                percent: 50,
                fixedAmount: null,
                amount: 45000,
                collected: 0,
              },
              {
                party: "CONTACT",
                contactId: ana,
                percent: 50,
                fixedAmount: null,
                amount: 45000,
                collected: 0,
              },
            ],
          },
        }),
      );

      const updated = await service.updateExpense(
        expenseId,
        { amount: 100000 },
        userId,
      );

      expect(updated.customSplit).toBe(true);
      expect(updated.split.shares.map((s) => s.amount)).toEqual([50000, 50000]);
    });

    // An exact split states amounts, so a new total makes it stop adding up: it is refused, not rescaled.
    it("refuses a new amount under a custom exact split, rather than rewriting what was typed", async () => {
      expenses.getByIdIncludingDeleted.mockResolvedValue(
        stored({
          customSplit: true,
          split: {
            mode: "EXACT",
            guests: null,
            shares: [
              {
                party: "USER",
                contactId: null,
                percent: null,
                fixedAmount: 50000,
                amount: 50000,
                collected: 0,
              },
              {
                party: "CONTACT",
                contactId: ana,
                percent: null,
                fixedAmount: 40000,
                amount: 40000,
                collected: 0,
              },
            ],
          },
        }),
      );

      await expect(
        service.updateExpense(expenseId, { amount: 120000 }, userId),
      ).rejects.toMatchObject({ code: "SPLIT_INVALID" });
    });

    it("takes the new amount when the same request restates the exact split", async () => {
      expenses.getByIdIncludingDeleted.mockResolvedValue(
        stored({
          customSplit: true,
          split: {
            mode: "EXACT",
            guests: null,
            shares: [
              {
                party: "USER",
                contactId: null,
                percent: null,
                fixedAmount: 50000,
                amount: 50000,
                collected: 0,
              },
              {
                party: "CONTACT",
                contactId: ana,
                percent: null,
                fixedAmount: 40000,
                amount: 40000,
                collected: 0,
              },
            ],
          },
        }),
      );

      const updated = await service.updateExpense(
        expenseId,
        {
          amount: 120000,
          split: {
            mode: "EXACT",
            shares: [
              { party: "USER", fixedAmount: 70000 },
              { party: "CONTACT", contactId: ana, fixedAmount: 50000 },
            ],
          },
        },
        userId,
      );

      expect(updated.split.shares.map((s) => s.amount)).toEqual([70000, 50000]);
    });

    it("answers 404 for an expense reached through another group's URL", async () => {
      expenses.getByIdIncludingDeleted.mockResolvedValue(stored());

      await expect(
        service.updateExpense(
          expenseId,
          { amount: 1000 },
          userId,
          undefined,
          "019576a0-d7b6-7d6d-af6a-2b7545f5acee",
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("goes back to the group's split and clears the flag", async () => {
      expenses.getByIdIncludingDeleted.mockResolvedValue(
        stored({
          customSplit: true,
          split: {
            mode: "EXACT",
            guests: null,
            shares: [
              {
                party: "USER",
                contactId: null,
                percent: null,
                fixedAmount: 90000,
                amount: 90000,
                collected: 0,
              },
            ],
          },
        }),
      );

      const updated = await service.updateExpense(
        expenseId,
        { useGroupSplit: true },
        userId,
      );

      expect(updated.customSplit).toBe(false);
      expect(updated.split.shares).toHaveLength(3);
    });

    it("refuses a body that both saves a split and goes back to the group's", async () => {
      await expect(
        service.updateExpense(
          expenseId,
          {
            useGroupSplit: true,
            split: { mode: "EQUAL", shares: [{ party: "USER" }] },
          },
          userId,
        ),
      ).rejects.toMatchObject({ code: "SPLIT_INVALID" });
    });

    it("answers 404 for somebody else's expense", async () => {
      expenses.getByIdIncludingDeleted.mockResolvedValue(
        stored({ userId: otherUserId }),
      );

      await expect(
        service.updateExpense(expenseId, { amount: 1000 }, userId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("is idempotent when deleting one already deleted", async () => {
      expenses.getByIdIncludingDeleted.mockResolvedValue(
        stored({ deletedAt: new Date() }),
      );

      await service.deleteExpense(expenseId, userId);

      expect(expenses.delete).not.toHaveBeenCalled();
    });

    describe("when it is a movement of yours [T-115]", () => {
      const linked = (): Transaction =>
        new Transaction({
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5acb1",
          type: "EXPENSE",
          amount: 120000,
          date,
          fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5acb2",
          userId,
          currency: "COP",
          sharedExpenseId: expenseId,
          sharedGroupId: groupId,
        });

      beforeEach(() => {
        expenses.getByIdIncludingDeleted.mockResolvedValue(stored());
        transactions.getBySharedExpenseId.mockResolvedValue(linked());
      });

      it.each(["amount", "date", "description", "paidByContactId"])(
        "refuses to restate its %s, which the movement states",
        async (field) => {
          const body = {
            amount: 1000,
            date,
            description: "Something else",
            paidByContactId: ana,
          };

          await expect(
            service.updateExpense(
              expenseId,
              { [field]: body[field as keyof typeof body] },
              userId,
            ),
          ).rejects.toMatchObject({ code: "SHARED_EXPENSE_LINKED" });
        },
      );

      it("writes a split change in the movement's history, with the figure unmoved", async () => {
        await service.updateExpense(
          expenseId,
          {
            split: {
              mode: "EQUAL",
              shares: [{ party: "USER" }, { party: "CONTACT", contactId: ana }],
            },
          },
          userId,
        );

        expect(transactions.applySharedChange).toHaveBeenCalledWith(
          "019576a0-d7b6-7d6d-af6a-2b7545f5acb1",
          userId,
          {
            sharedExpenseId: expenseId,
            sharedGroupId: groupId,
            countsAsYours: 120000,
          },
          expect.objectContaining({
            reason: "SPLIT_EDITED",
            countsAsYours: 120000,
          }),
          "test-session",
        );
      });

      it("hands the whole amount back when the expense leaves the group", async () => {
        expenses.delete.mockResolvedValue(stored({ deletedAt: new Date() }));

        await service.deleteExpense(expenseId, userId);

        expect(transactions.applySharedChange).toHaveBeenCalledWith(
          "019576a0-d7b6-7d6d-af6a-2b7545f5acb1",
          userId,
          {
            sharedExpenseId: null,
            sharedGroupId: null,
            countsAsYours: 120000,
          },
          expect.objectContaining({
            reason: "UNSPLIT",
            countsAsYours: 120000,
          }),
          "test-session",
        );
      });
    });
  });
});
