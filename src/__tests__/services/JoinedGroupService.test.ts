jest.mock("../../shared/unitOfWork", () => ({
  withTransaction: jest.fn((fn: (session: unknown) => unknown) => fn({})),
}));

import { JoinedGroupService } from "../../app/services/JoinedGroupService";
import { TransactionService } from "../../app/services/TransactionService";
import { Contact } from "../../domain/entities/Contact";
import {
  SharedExpense,
  SharedShare,
} from "../../domain/entities/SharedExpense";
import { SharedGroup } from "../../domain/entities/SharedGroup";
import { SharedInvitation } from "../../domain/entities/SharedInvitation";
import { Transaction } from "../../domain/entities/Transaction";
import { User } from "../../domain/entities/User";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { mockInvitationRepo } from "./invitationRepoMock";

const ownerId = "019576a0-d7b6-7d6d-af6a-2b7545f5ad01";
const meId = "019576a0-d7b6-7d6d-af6a-2b7545f5ad02";
const martaId = "019576a0-d7b6-7d6d-af6a-2b7545f5ad03";
const groupId = "019576a0-d7b6-7d6d-af6a-2b7545f5ad04";
const myContact = "019576a0-d7b6-7d6d-af6a-2b7545f5ad05";
const martaContact = "019576a0-d7b6-7d6d-af6a-2b7545f5ad06";
const carlosContact = "019576a0-d7b6-7d6d-af6a-2b7545f5ad07";
const expenseId = "019576a0-d7b6-7d6d-af6a-2b7545f5ad08";
const accountId = "019576a0-d7b6-7d6d-af6a-2b7545f5ad09";
const categoryId = "019576a0-d7b6-7d6d-af6a-2b7545f5ad0a";

const at = (iso: string): Date => new Date(iso);

const user = (id: string, name: string, updatedAt = at("2026-09-01")): User =>
  new User({
    id,
    name,
    email: `${name.toLowerCase()}@example.com`,
    password: "x",
    currency: "COP",
    updatedAt,
  });

const contact = (
  id: string,
  name: string,
  updatedAt = at("2026-09-01"),
): Contact =>
  new Contact({ id, name, userId: ownerId, color: "TEAL", updatedAt });

const membershipOf = (
  props: Partial<SharedInvitation> = {},
): SharedInvitation =>
  new SharedInvitation({
    id: "019576a0-d7b6-7d6d-af6a-2b7545f5ad10",
    userId: ownerId,
    groupId,
    contactId: myContact,
    email: "me@example.com",
    status: "ACCEPTED",
    inviteeId: meId,
    answeredAt: at("2026-09-10"),
    expiresAt: at("2026-10-01"),
    groupName: "Villa de Leyva weekend",
    groupCurrency: "COP",
    inviterName: "Ana Ruiz",
    inviterEmail: "ana@example.com",
    updatedAt: at("2026-09-10"),
    ...props,
  });

const group = new SharedGroup({
  id: groupId,
  name: "Villa de Leyva weekend",
  userId: ownerId,
  currency: "COP",
  participants: [
    { contactId: null },
    { contactId: myContact },
    { contactId: martaContact },
    { contactId: carlosContact },
  ],
  updatedAt: at("2026-09-05"),
});

const share = (
  party: SharedShare["party"],
  contactId: string | null,
  amount: number,
  collected = 0,
): SharedShare => ({
  party,
  contactId,
  percent: null,
  fixedAmount: null,
  amount,
  collected,
});

const line = (props: Partial<SharedExpense> = {}): SharedExpense =>
  new SharedExpense({
    id: expenseId,
    groupId,
    description: "Groceries at the market",
    date: at("2026-09-19T15:00:00Z"),
    amount: 240000,
    userId: ownerId,
    currency: "COP",
    split: {
      mode: "EQUAL",
      guests: null,
      shares: [
        share("USER", null, 60000),
        share("CONTACT", myContact, 60000, 60000),
        share("CONTACT", martaContact, 60000),
        share("CONTACT", carlosContact, 60000),
      ],
    },
    updatedAt: at("2026-09-06"),
    ...props,
  });

describe("JoinedGroupService", () => {
  let invitations: ReturnType<typeof mockInvitationRepo>;
  let groups: jest.Mocked<ISharedGroupRepository>;
  let expenses: jest.Mocked<ISharedExpenseRepository>;
  let contacts: jest.Mocked<IContactRepository>;
  let users: jest.Mocked<IUserRepository>;
  let transactions: jest.Mocked<ITransactionRepository>;
  let recordAnswered: jest.Mock;
  let service: JoinedGroupService;

  beforeEach(() => {
    invitations = mockInvitationRepo();
    invitations.memberships.mockResolvedValue([membershipOf()]);
    invitations.inGroups.mockResolvedValue([
      membershipOf(),
      membershipOf({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ad11",
        contactId: martaContact,
        inviteeId: martaId,
        updatedAt: at("2026-09-08"),
      }),
    ]);
    groups = {
      getManyIncludingArchived: jest.fn().mockResolvedValue([group]),
    } as unknown as jest.Mocked<ISharedGroupRepository>;
    expenses = {
      getById: jest.fn().mockResolvedValue(line()),
      changesInGroups: jest.fn().mockResolvedValue([]),
      atJoin: jest.fn().mockResolvedValue([]),
      getAllByGroup: jest.fn(),
    } as unknown as jest.Mocked<ISharedExpenseRepository>;
    contacts = {
      getManyIncludingArchived: jest
        .fn()
        .mockResolvedValue([
          contact(myContact, "Johnny"),
          contact(martaContact, "Martica"),
          contact(carlosContact, "Carlitos"),
        ]),
    } as unknown as jest.Mocked<IContactRepository>;
    users = {
      getManyByIds: jest
        .fn()
        .mockResolvedValue([
          user(ownerId, "Ana Ruiz"),
          user(meId, "John Doe"),
          user(martaId, "Marta Ríos"),
        ]),
    } as unknown as jest.Mocked<IUserRepository>;
    transactions = {
      getOwnById: jest.fn().mockResolvedValue(null),
      getImported: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ITransactionRepository>;
    recordAnswered = jest.fn(async (dto: Record<string, unknown>) =>
      Object.assign(new Transaction(dto as unknown as Transaction), {
        restamped: [],
      }),
    );
    service = new JoinedGroupService(
      invitations,
      groups,
      expenses,
      contacts,
      users,
      transactions,
      { recordAnswered } as unknown as TransactionService,
    );
  });

  describe("the group", () => {
    it("names the owner and whoever joined by their own profile, the rest by the owner's name for them", async () => {
      const view = await service.get(groupId, meId);

      expect(view.ownerName).toBe("Ana Ruiz");
      expect(view.participants).toEqual([
        {
          contactId: null,
          name: "Ana Ruiz",
          color: null,
          you: false,
          joined: true,
        },
        {
          contactId: myContact,
          name: "John Doe",
          color: "TEAL",
          you: true,
          joined: true,
        },
        {
          contactId: martaContact,
          name: "Marta Ríos",
          color: "TEAL",
          you: false,
          joined: true,
        },
        {
          contactId: carlosContact,
          name: "Carlitos",
          color: "TEAL",
          you: false,
          joined: false,
        },
      ]);
    });

    it("carries nothing of the owner's ledger", async () => {
      const view = await service.get(groupId, meId);

      expect(view).not.toHaveProperty("userId");
      expect(view).not.toHaveProperty("totals");
    });

    it("moves when a name it shows changes, not only when the group does", async () => {
      contacts.getManyIncludingArchived.mockResolvedValue([
        contact(myContact, "Johnny"),
        contact(martaContact, "Martica"),
        contact(carlosContact, "Carlos", at("2026-09-15")),
      ]);

      const view = await service.get(groupId, meId);

      expect(view.updatedAt).toEqual(at("2026-09-15"));
    });

    it("is not found for somebody who has not joined it", async () => {
      invitations.memberships.mockResolvedValue([]);

      await expect(service.get(groupId, meId)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe("the feed", () => {
    it("sends a group joined after the cursor whole, placed at the moment of joining", async () => {
      const older = line({ updatedAt: at("2026-09-02") });
      expenses.atJoin.mockResolvedValue([older]);
      const cursor = { updatedAt: at("2026-09-09"), id: null };

      const changes = await service.changes(meId, cursor, 10);

      expect(expenses.atJoin).toHaveBeenCalledWith(
        groupId,
        at("2026-09-10"),
        null,
        10,
      );
      expect(expenses.changesInGroups).toHaveBeenCalledWith(
        [{ groupId, after: at("2026-09-10") }],
        cursor,
        10,
      );
      expect(changes.expenses).toHaveLength(1);
      expect(changes.expenses[0]?.updatedAt).toEqual(at("2026-09-10"));
      expect(changes.groups).toHaveLength(1);
    });

    it("resumes a join cut by a page at the id it stopped on, never from the start", async () => {
      const cursor = {
        updatedAt: at("2026-09-10"),
        id: "019576a0-0000-7000-8000-000000000001",
      };

      await service.changes(meId, cursor, 10);

      expect(expenses.atJoin).toHaveBeenCalledWith(
        groupId,
        at("2026-09-10"),
        cursor.id,
        10,
      );
    });

    it("asks a group joined before the cursor only for what changed since", async () => {
      const cursor = { updatedAt: at("2026-09-12"), id: null };

      await service.changes(meId, cursor, 10);

      expect(expenses.changesInGroups).toHaveBeenCalledWith(
        [{ groupId, after: null }],
        cursor,
        10,
      );
      expect(expenses.atJoin).not.toHaveBeenCalled();
    });

    it("reads nothing else for somebody who joined nothing", async () => {
      invitations.memberships.mockResolvedValue([]);

      const changes = await service.changes(meId, undefined, 10);

      expect(changes).toEqual({ groups: [], expenses: [] });
      expect(groups.getManyIncludingArchived).not.toHaveBeenCalled();
    });
  });

  describe("Add to my ledger", () => {
    const dto = { accountId, categoryId };

    it("writes your share as your expense, dated the line, and nothing in the group", async () => {
      await service.addToLedger(
        groupId,
        expenseId,
        dto,
        meId,
        "America/Bogota",
      );

      expect(recordAnswered).toHaveBeenCalledWith(
        {
          id: undefined,
          type: "EXPENSE",
          amount: 60000,
          date: at("2026-09-19T15:00:00Z"),
          description: "Groceries at the market",
          categoryId,
          fromAccountId: accountId,
          userId: meId,
          currency: "COP",
          importedFromGroupId: groupId,
          importedFromExpenseId: expenseId,
        },
        "America/Bogota",
        expect.anything(),
      );
    });

    it("refuses a part the owner has not marked paid", async () => {
      expenses.getById.mockResolvedValue(
        line({
          split: {
            mode: "EQUAL",
            guests: null,
            shares: [
              share("USER", null, 60000),
              share("CONTACT", myContact, 60000, 30000),
            ],
          },
        }),
      );

      await expect(
        service.addToLedger(groupId, expenseId, dto, meId, "UTC"),
      ).rejects.toMatchObject({ code: "SHARED_LINE_NOT_PAID" });
      expect(recordAnswered).not.toHaveBeenCalled();
    });

    it("refuses a line somebody other than the owner paid", async () => {
      expenses.getById.mockResolvedValue(
        line({ paidByContactId: martaContact }),
      );

      await expect(
        service.addToLedger(groupId, expenseId, dto, meId, "UTC"),
      ).rejects.toMatchObject({ code: "SHARED_LINE_NOT_PAID" });
    });

    it("refuses a line you have no part in", async () => {
      expenses.getById.mockResolvedValue(
        line({
          split: {
            mode: "EQUAL",
            guests: null,
            shares: [share("USER", null, 240000)],
          },
        }),
      );

      await expect(
        service.addToLedger(groupId, expenseId, dto, meId, "UTC"),
      ).rejects.toMatchObject({ code: "SHARED_LINE_NOT_PAID" });
    });

    it("refuses a line already in your ledger", async () => {
      transactions.getImported.mockResolvedValue(
        new Transaction({
          type: "EXPENSE",
          amount: 60000,
          date: at("2026-09-19"),
          userId: meId,
        }),
      );

      await expect(
        service.addToLedger(groupId, expenseId, dto, meId, "UTC"),
      ).rejects.toMatchObject({ code: "SHARED_LINE_IN_LEDGER" });
    });

    it("answers two devices adding the same line at once with the same refusal", async () => {
      recordAnswered.mockRejectedValue(
        Object.assign(new Error("E11000"), {
          code: 11000,
          keyPattern: { userId: 1, importedFromExpenseId: 1 },
        }),
      );

      await expect(
        service.addToLedger(groupId, expenseId, dto, meId, "UTC"),
      ).rejects.toMatchObject({ code: "SHARED_LINE_IN_LEDGER" });
    });

    it("is not found for a line of another group", async () => {
      expenses.getById.mockResolvedValue(line({ groupId: "other" }));

      await expect(
        service.addToLedger(groupId, expenseId, dto, meId, "UTC"),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("replays what a lost response already created under the same id", async () => {
      const stored = new Transaction({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ad20",
        type: "EXPENSE",
        amount: 60000,
        date: at("2026-09-19"),
        userId: meId,
      });
      transactions.getOwnById.mockResolvedValue(stored);
      const outcome = { replayed: false };

      const result = await service.addToLedger(
        groupId,
        expenseId,
        { ...dto, id: stored.id },
        meId,
        "UTC",
        outcome,
      );

      expect(result).toBe(stored);
      expect(outcome.replayed).toBe(true);
      expect(recordAnswered).not.toHaveBeenCalled();
    });
  });
});
