jest.mock("../../shared/unitOfWork", () => ({
  withTransaction: jest.fn((fn: (session: unknown) => unknown) =>
    fn("test-session"),
  ),
}));

import { SharedLedgerService } from "../../app/services/SharedLedgerService";
import { SharedSettlementService } from "../../app/services/SharedSettlementService";
import { TransactionService } from "../../app/services/TransactionService";
import { SharedExpense } from "../../domain/entities/SharedExpense";
import { SharedGroup } from "../../domain/entities/SharedGroup";
import { SharedSettlement } from "../../domain/entities/SharedSettlement";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ISharedSettlementRepository } from "../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { noAccountStamps } from "./accountStampsMock";
import { counterpartyClaims } from "./counterpartyClaimsMock";

const userId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const otherUserId = "019576a0-d7b6-7d6d-af6a-2b7545f5acff";
const ana = "019576a0-d7b6-7d6d-af6a-2b7545f5aca1";
const CINE = "019576a0-d7b6-7d6d-af6a-2b7545f5ab00";
const COMER = "019576a0-d7b6-7d6d-af6a-2b7545f5ab01";
const OLDER = "019576a0-d7b6-7d6d-af6a-2b7545f5ae01";
const NEWER = "019576a0-d7b6-7d6d-af6a-2b7545f5ae02";

const line = (
  id: string,
  groupId: string,
  day: string,
  amount: number,
): SharedExpense =>
  new SharedExpense({
    id,
    groupId,
    description: groupId === CINE ? "Cine" : "Comer",
    date: new Date(`2026-08-${day}T18:00:00.000Z`),
    updatedAt: new Date("2026-08-26T09:00:00.000Z"),
    amount,
    paidByContactId: null,
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
          amount: amount / 2,
          collected: 0,
        },
        {
          party: "CONTACT",
          contactId: ana,
          percent: null,
          fixedAmount: null,
          amount: amount / 2,
          collected: 0,
        },
      ],
    },
  });

const group = (props: Partial<SharedGroup> = {}): SharedGroup =>
  new SharedGroup({ id: COMER, name: "Comer", userId, ...props });

describe("SharedSettlementService: a payment from a group [T-240]", () => {
  let settlements: jest.Mocked<ISharedSettlementRepository>;
  let groups: jest.Mocked<ISharedGroupRepository>;
  let service: SharedSettlementService;
  let stored: SharedSettlement[];

  beforeEach(() => {
    stored = [];
    settlements = {
      create: jest.fn(async (row: SharedSettlement) => {
        const saved = new SharedSettlement({
          ...row,
          createdAt: new Date("2026-08-26T10:00:00.000Z"),
        });
        stored.push(saved);
        return saved;
      }),
      listByCounterparty: jest.fn(async () => stored),
      getOwnById: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ISharedSettlementRepository>;
    const expenses = {
      listByCounterparty: jest
        .fn()
        .mockResolvedValue([
          line(OLDER, CINE, "10", 100_000),
          line(NEWER, COMER, "20", 40_000),
        ]),
      replaceSplits: jest.fn().mockResolvedValue(undefined),
      stampsOf: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<ISharedExpenseRepository>;
    groups = {
      getByIdIncludingArchived: jest.fn().mockResolvedValue(group()),
    } as unknown as jest.Mocked<ISharedGroupRepository>;
    const contacts = {
      getByIdIncludingArchived: jest
        .fn()
        .mockResolvedValue({ id: ana, userId, name: "Ana" }),
    } as unknown as jest.Mocked<IContactRepository>;
    const users = {
      getById: jest.fn().mockResolvedValue({ id: userId, currency: "COP" }),
    } as unknown as jest.Mocked<IUserRepository>;
    const movements = {
      listBySharedExpenseIds: jest.fn().mockResolvedValue([]),
      stampsOf: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<ITransactionRepository>;
    const ledger = new SharedLedgerService(
      expenses,
      settlements,
      movements,
      noAccountStamps(),
      counterpartyClaims(),
    );
    service = new SharedSettlementService(
      settlements,
      expenses,
      groups,
      contacts,
      users,
      ledger,
      {
        recordWithin: jest.fn().mockResolvedValue([]),
      } as unknown as TransactionService,
    );
  });

  const settle = (
    over: Record<string, unknown> = {},
  ): ReturnType<SharedSettlementService["createSettlement"]> =>
    service.createSettlement(
      {
        userId,
        contactId: ana,
        date: new Date("2026-08-25T18:00:00.000Z"),
        collected: 30_000,
        outsideApp: true,
        ...over,
      },
      "America/Bogota",
    );

  it("stores the group and covers its line first, then the oldest elsewhere", async () => {
    const result = await settle({ groupId: COMER });

    expect(groups.getByIdIncludingArchived).toHaveBeenCalledWith(
      COMER,
      "test-session",
    );
    expect(settlements.create.mock.calls[0]?.[0].groupId).toBe(COMER);
    expect(result.settlement.groupId).toBe(COMER);
    // Her 20.000 of Comer first, though Cine is older; the other 10.000 reach Cine.
    expect(
      result.covered.map((one) => [one.expenseId, one.amount, one.direction]),
    ).toEqual([
      [NEWER, 20_000, "COLLECTED"],
      [OLDER, 10_000, "COLLECTED"],
    ]);
  });

  it("records a payment from People with no group, oldest line first", async () => {
    const result = await settle();

    expect(groups.getByIdIncludingArchived).not.toHaveBeenCalled();
    expect(result.settlement.groupId).toBeNull();
    expect(result.covered.map((one) => [one.expenseId, one.amount])).toEqual([
      [OLDER, 30_000],
    ]);
  });

  it("takes a null group as no group", async () => {
    const result = await settle({ groupId: null });

    expect(groups.getByIdIncludingArchived).not.toHaveBeenCalled();
    expect(result.settlement.groupId).toBeNull();
  });

  it("takes an archived group: what it still owes can be settled", async () => {
    groups.getByIdIncludingArchived.mockResolvedValue(
      group({ archivedAt: new Date("2026-08-24T10:00:00.000Z") }),
    );

    const result = await settle({ groupId: COMER });

    expect(result.settlement.groupId).toBe(COMER);
  });

  it.each([
    ["another user's group", group({ userId: otherUserId })],
    ["a group that does not exist", null],
  ])("answers 404 for %s and records nothing", async (_case, found) => {
    groups.getByIdIncludingArchived.mockResolvedValue(found);

    await expect(settle({ groupId: COMER })).rejects.toMatchObject({
      statusCode: 404,
      message: "Shared group not found",
    });
    expect(settlements.create).not.toHaveBeenCalled();
  });
});
