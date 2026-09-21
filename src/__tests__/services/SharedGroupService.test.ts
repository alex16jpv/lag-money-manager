jest.mock("../../shared/unitOfWork", () => ({
  withTransaction: jest.fn((fn: (session: unknown) => unknown) => fn({})),
}));

import { SharedGroupService } from "../../app/services/SharedGroupService";
import { SharedLedgerService } from "../../app/services/SharedLedgerService";
import { SharedExpense } from "../../domain/entities/SharedExpense";
import { SharedGroup } from "../../domain/entities/SharedGroup";
import { Transaction } from "../../domain/entities/Transaction";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ISharedSettlementRepository } from "../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { MAX_GROUP_PARTICIPANTS } from "../../shared/constants";

const userId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const otherUserId = "019576a0-d7b6-7d6d-af6a-2b7545f5acff";
const groupId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";
const ana = "019576a0-d7b6-7d6d-af6a-2b7545f5aca1";
const beto = "019576a0-d7b6-7d6d-af6a-2b7545f5aca2";
const carla = "019576a0-d7b6-7d6d-af6a-2b7545f5aca3";
const version = new Date("2026-09-20T10:00:00.000Z");

const makeGroup = (props: Partial<SharedGroup> = {}): SharedGroup =>
  new SharedGroup({
    id: groupId,
    name: "Night out",
    userId,
    currency: "COP",
    participants: [{ contactId: null }, { contactId: ana }],
    defaultSplit: { mode: "EQUAL", shares: [] },
    updatedAt: version,
    ...props,
  });

const equalExpense = (
  amount: number,
  contactIds: (string | null)[],
  props: Partial<SharedExpense> = {},
): SharedExpense =>
  new SharedExpense({
    id: "019576a0-d7b6-7d6d-af6a-2b7545f5acb1",
    groupId,
    date: new Date("2026-09-15T18:00:00.000Z"),
    amount,
    userId,
    currency: "COP",
    split: {
      mode: "EQUAL",
      guests: null,
      shares: contactIds.map((contactId) => ({
        party: contactId === null ? ("USER" as const) : ("CONTACT" as const),
        contactId,
        percent: null,
        fixedAmount: null,
        amount: amount / contactIds.length,
        collected: 0,
      })),
    },
    ...props,
  });

const groupRepo = (): jest.Mocked<ISharedGroupRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn().mockResolvedValue(makeGroup()),
  changesSince: jest.fn().mockResolvedValue([]),
  getOwnById: jest.fn(),
  create: jest.fn().mockImplementation(async (g) => g as SharedGroup),
  update: jest
    .fn()
    .mockImplementation(
      async (_id, write) =>
        new SharedGroup({ ...makeGroup(), ...(write as Partial<SharedGroup>) }),
    ),
  delete: jest.fn(),
  restore: jest.fn(),
});

const expenseRepo = (): jest.Mocked<ISharedExpenseRepository> => ({
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
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

const contactRepo = (): jest.Mocked<IContactRepository> =>
  ({
    listActiveIds: jest.fn().mockImplementation(async (_u, ids) => ids),
  }) as unknown as jest.Mocked<IContactRepository>;

const userRepo = (): jest.Mocked<IUserRepository> =>
  ({
    getById: jest.fn().mockResolvedValue({ id: userId, currency: "COP" }),
  }) as unknown as jest.Mocked<IUserRepository>;

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

const transactionRepo = (): jest.Mocked<ITransactionRepository> => ({
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

describe("SharedGroupService", () => {
  let service: SharedGroupService;
  let groups: jest.Mocked<ISharedGroupRepository>;
  let expenses: jest.Mocked<ISharedExpenseRepository>;
  let contacts: jest.Mocked<IContactRepository>;
  let transactions: jest.Mocked<ITransactionRepository>;

  beforeEach(() => {
    groups = groupRepo();
    expenses = expenseRepo();
    contacts = contactRepo();
    transactions = transactionRepo();
    const settlements = settlementRepo();
    service = new SharedGroupService(
      groups,
      expenses,
      contacts,
      userRepo(),
      transactions,
      new SharedLedgerService(expenses, settlements, transactions),
    );
  });

  describe("creating one", () => {
    it("always puts the owner in, as a row like anybody else", async () => {
      const view = await service.createGroup({
        name: "Night out",
        contactIds: [ana],
        userId,
      });

      expect(view.participants.map((p) => p.contactId)).toEqual([null, ana]);
      expect(view.defaultSplit.mode).toBe("EQUAL");
      expect(view.totals.expenseCount).toBe(0);
    });

    it("stamps the owner's currency", async () => {
      const view = await service.createGroup({ name: "Trip", userId });

      expect(view.currency).toBe("COP");
    });

    it("refuses a percentage default that does not cover everybody", async () => {
      await expect(
        service.createGroup({
          name: "Night out",
          contactIds: [ana],
          defaultSplit: {
            mode: "PERCENT",
            shares: [{ contactId: null, percent: 100 }],
          },
          userId,
        }),
      ).rejects.toMatchObject({ code: "SPLIT_INVALID" });
    });

    it("refuses a percentage default that does not add up to 100", async () => {
      await expect(
        service.createGroup({
          name: "Night out",
          contactIds: [ana],
          defaultSplit: {
            mode: "PERCENT",
            shares: [
              { contactId: null, percent: 60 },
              { contactId: ana, percent: 30 },
            ],
          },
          userId,
        }),
      ).rejects.toMatchObject({ code: "SPLIT_INVALID" });
    });

    it("refuses the same person twice", async () => {
      await expect(
        service.createGroup({
          name: "Night out",
          contactIds: [ana, ana],
          userId,
        }),
      ).rejects.toMatchObject({ code: "PARTICIPANT_ALREADY_IN_GROUP" });
    });

    it("refuses more people than a group holds, the owner included", async () => {
      contacts.listActiveIds.mockImplementation(async (_u, ids) => ids);
      const many = Array.from(
        { length: MAX_GROUP_PARTICIPANTS },
        (_v, index) =>
          `019576a0-d7b6-7d6d-af6a-2b7545f5a${String(index).padStart(3, "0")}`,
      );

      await expect(
        service.createGroup({ name: "Night out", contactIds: many, userId }),
      ).rejects.toMatchObject({ code: "PARTICIPANT_LIMIT_REACHED" });
    });

    it("refuses a contact that is not the caller's", async () => {
      contacts.listActiveIds.mockResolvedValue([]);

      await expect(
        service.createGroup({ name: "Night out", contactIds: [ana], userId }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("adding people", () => {
    const add = (body: Record<string, unknown> = {}) =>
      service.addParticipants(groupId, { contactIds: [beto], ...body }, userId);

    it("leaves what is already recorded alone by default", async () => {
      expenses.listByGroup.mockResolvedValue([
        equalExpense(90000, [null, ana]),
      ]);

      const { applied } = await add();

      expect(applied.expenses).toEqual({ total: 1, resplit: 0, untouched: 1 });
      expect(expenses.replaceSplits).toHaveBeenCalledWith(
        [],
        expect.anything(),
      );
    });

    it("splits everything again when it is asked to, and says what it did", async () => {
      expenses.listByGroup.mockResolvedValue([
        equalExpense(90000, [null, ana]),
      ]);

      const { applied } = await add({ applyToExistingExpenses: true });

      expect(applied.expenses).toEqual({ total: 1, resplit: 1, untouched: 0 });
      expect(applied.participants).toEqual([
        { contactId: null, shareBefore: 45000, shareAfter: 30000 },
        { contactId: ana, shareBefore: 45000, shareAfter: 30000 },
        { contactId: beto, shareBefore: 0, shareAfter: 30000 },
      ]);
    });

    it("says in the movement's history that its split changed [T-115]", async () => {
      const expense = equalExpense(90000, [null, ana]);
      expenses.listByGroup.mockResolvedValue([expense]);
      const movement = new Transaction({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5acd1",
        type: "EXPENSE",
        amount: 90000,
        date: new Date("2026-08-12T18:00:00.000Z"),
        fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5acd2",
        userId,
        currency: "COP",
        sharedExpenseId: expense.id,
        sharedGroupId: groupId,
      });
      transactions.listBySharedExpenseIds.mockResolvedValue([movement]);

      await add({ applyToExistingExpenses: true });

      expect(transactions.applySharedChange).toHaveBeenCalledWith(
        movement.id,
        userId,
        expect.objectContaining({
          sharedExpenseId: expense.id,
          countsAsYours: 90000,
        }),
        expect.objectContaining({
          reason: "SPLIT_EDITED",
          countsAsYours: 90000,
        }),
        expect.anything(),
      );
    });

    it("leaves an expense with its own exact split alone, because a figure would be invented", async () => {
      expenses.listByGroup.mockResolvedValue([
        equalExpense(90000, [null, ana], {
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
      ]);

      const { applied } = await add({ applyToExistingExpenses: true });

      expect(applied.expenses).toEqual({ total: 1, resplit: 0, untouched: 1 });
      expect(
        applied.participants.find((p) => p.contactId === beto)?.shareAfter,
      ).toBe(0);
    });

    it("re-divides an expense with its own equal split", async () => {
      expenses.listByGroup.mockResolvedValue([
        equalExpense(90000, [null, ana], { customSplit: true }),
      ]);

      const { applied } = await add({ applyToExistingExpenses: true });

      expect(applied.expenses.resplit).toBe(1);
    });

    it("writes nothing when it is only asked to simulate", async () => {
      expenses.listByGroup.mockResolvedValue([
        equalExpense(90000, [null, ana]),
      ]);

      const preview = await service.previewParticipants(
        groupId,
        { contactIds: [beto], applyToExistingExpenses: true },
        userId,
      );

      expect(preview.expenses.resplit).toBe(1);
      expect(groups.update).not.toHaveBeenCalled();
      expect(expenses.replaceSplits).not.toHaveBeenCalled();
    });

    it("asks a percentage group for the new percentages", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({
          defaultSplit: {
            mode: "PERCENT",
            shares: [
              { contactId: null, percent: 50 },
              { contactId: ana, percent: 50 },
            ],
          },
        }),
      );

      await expect(add()).rejects.toMatchObject({ code: "SPLIT_INVALID" });
    });

    it("takes the new percentages when they are given", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({
          defaultSplit: {
            mode: "PERCENT",
            shares: [
              { contactId: null, percent: 50 },
              { contactId: ana, percent: 50 },
            ],
          },
        }),
      );

      const { group } = await add({
        defaultSplit: {
          mode: "PERCENT",
          shares: [
            { contactId: null, percent: 40 },
            { contactId: ana, percent: 40 },
            { contactId: beto, percent: 20 },
          ],
        },
      });

      expect(group.defaultSplit.shares).toHaveLength(3);
    });

    it("refuses somebody the group already has", async () => {
      await expect(add({ contactIds: [ana] })).rejects.toMatchObject({
        code: "PARTICIPANT_ALREADY_IN_GROUP",
      });
    });

    it("refuses an archived group", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ archivedAt: new Date() }),
      );

      await expect(add()).rejects.toMatchObject({ code: "RESOURCE_ARCHIVED" });
    });
  });

  describe("taking somebody out", () => {
    it("takes out somebody with no share anywhere", async () => {
      const updated = await service.removeParticipant(groupId, ana, userId);

      expect(updated.participants.map((p) => p.contactId)).toEqual([null]);
    });

    it("refuses while they hold a share of an expense", async () => {
      expenses.countSharesOfContact.mockResolvedValue(1);

      await expect(
        service.removeParticipant(groupId, ana, userId),
      ).rejects.toMatchObject({ code: "PARTICIPANT_IN_USE" });
    });

    it("refuses somebody who is not in the group", async () => {
      await expect(
        service.removeParticipant(groupId, carla, userId),
      ).rejects.toMatchObject({ code: "PARTICIPANT_NOT_IN_GROUP" });
    });

    it("spreads their percentage over the rest so the default still adds up", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({
          participants: [
            { contactId: null },
            { contactId: ana },
            { contactId: beto },
          ],
          defaultSplit: {
            mode: "PERCENT",
            shares: [
              { contactId: null, percent: 50 },
              { contactId: ana, percent: 20 },
              { contactId: beto, percent: 30 },
            ],
          },
        }),
      );

      const updated = await service.removeParticipant(groupId, ana, userId);

      const percents = updated.defaultSplit.shares.map((s) => s.percent);
      expect(percents.reduce((a, b) => a + b, 0)).toBe(100);
      expect(percents).toEqual([62.5, 37.5]);
    });
  });

  describe("giving up on what somebody owes [T-117]", () => {
    const owing = (owedCents: number): SharedExpense => {
      const expense = equalExpense(90000, [null, ana]);
      expenses.listByGroup.mockResolvedValue([expense]);
      expenses.totalsByGroup.mockResolvedValue([
        {
          groupId,
          total: 90000,
          yourShare: 45000,
          owedToYou: owedCents / 100,
          youOwe: 0,
          collected: 0,
          owedByParty: [{ contactId: ana, expenseId: null, owedCents }],
          expenseCount: 1,
          dateFrom: new Date("2026-08-10T00:00:00.000Z"),
          dateTo: new Date("2026-08-10T00:00:00.000Z"),
        },
      ]);
      transactions.listBySharedExpenseIds.mockResolvedValue([
        new Transaction({
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5acd1",
          type: "EXPENSE",
          amount: 90000,
          date: new Date("2026-08-10T18:00:00.000Z"),
          fromAccountId: "019576a0-d7b6-7d6d-af6a-2b7545f5acd2",
          userId,
          currency: "COP",
          sharedExpenseId: expense.id,
          sharedGroupId: groupId,
        }),
      ]);
      groups.update.mockImplementation(async (_id, write) =>
        makeGroup(write as Partial<SharedGroup>),
      );
      return expense;
    };

    it("takes it out of what is owed, and the movement only records that", async () => {
      owing(4500000);

      const view = await service.writeOff(groupId, { contactId: ana }, userId);

      expect(view.totals.writtenOff).toBe(45000);
      expect(view.totals.owedToYou).toBe(0);
      expect(view.status).toBe("SETTLED");
      // The figure is written back unchanged: the entry is there to say it did not move.
      expect(transactions.applySharedChange).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5acd1",
        userId,
        expect.objectContaining({ countsAsYours: 90000 }),
        expect.objectContaining({
          reason: "WRITE_OFF",
          countsAsYours: 90000,
        }),
        expect.anything(),
      );
    });

    it("never gives up on more than was open when it was decided", async () => {
      owing(4500000);
      await service.writeOff(groupId, { contactId: ana }, userId);
      const given = (groups.update.mock.calls[0]?.[1] as SharedGroup).writeOffs;
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ writeOffs: given }),
      );
      // A line added afterwards doubles what she owes; the ceiling stays where it was.
      owing(9000000);

      const view = await service.getGroupById(groupId, userId);

      expect(view.totals.writtenOff).toBe(45000);
      expect(view.totals.owedToYou).toBe(45000);
      expect(view.status).toBe("OPEN");
    });

    it("refuses somebody who is not in the group", async () => {
      owing(4500000);

      await expect(
        service.writeOff(
          groupId,
          { contactId: "019576a0-d7b6-7d6d-af6a-2b7545f5acff" },
          userId,
        ),
      ).rejects.toMatchObject({ code: "PARTICIPANT_NOT_IN_GROUP" });
    });

    it("refuses one on an archived group, which is where it stops being undoable", async () => {
      owing(4500000);
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ archivedAt: new Date() }),
      );

      await expect(
        service.writeOff(groupId, { contactId: ana }, userId),
      ).rejects.toMatchObject({ code: "RESOURCE_ARCHIVED" });
    });
  });

  describe("reading one", () => {
    it("derives the range and the totals from the expenses", async () => {
      expenses.totalsByGroup.mockResolvedValue([
        {
          groupId,
          total: 150000,
          yourShare: 50000,
          owedToYou: 0,
          youOwe: 0,
          collected: 0,
          owedByParty: [],
          expenseCount: 2,
          dateFrom: new Date("2026-08-01T00:00:00.000Z"),
          dateTo: new Date("2026-09-30T00:00:00.000Z"),
        },
      ]);

      const view = await service.getGroupById(groupId, userId);

      expect(view.totals.amount).toBe(150000);
      expect(view.totals.expenseCount).toBe(2);
      expect(view.totals.dateFrom?.getUTCMonth()).toBe(7);
    });

    it("answers zeroes for a group with no expenses yet", async () => {
      const view = await service.getGroupById(groupId, userId);

      expect(view.totals).toEqual({
        amount: 0,
        yourShare: 0,
        owedToYou: 0,
        youOwe: 0,
        collected: 0,
        writtenOff: 0,
        expenseCount: 0,
        dateFrom: null,
        dateTo: null,
      });
      // Nobody owes anything in a group with nothing in it.
      expect(view.status).toBe("SETTLED");
    });

    it("answers 404 for somebody else's group", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ userId: otherUserId }),
      );

      await expect(service.getGroupById(groupId, userId)).rejects.toMatchObject(
        { statusCode: 404 },
      );
    });
  });

  describe("changing the default split", () => {
    it("never goes back over what is already recorded", async () => {
      expenses.listByGroup.mockResolvedValue([
        equalExpense(90000, [null, ana]),
      ]);

      await service.updateGroup(
        groupId,
        {
          defaultSplit: {
            mode: "PERCENT",
            shares: [
              { contactId: null, percent: 70 },
              { contactId: ana, percent: 30 },
            ],
          },
        },
        userId,
      );

      expect(expenses.replaceSplits).not.toHaveBeenCalled();
    });
  });
});
