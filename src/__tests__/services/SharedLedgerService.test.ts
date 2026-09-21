import {
  counterpartiesOf,
  RecomputeResult,
  SharedLedgerService,
} from "../../app/services/SharedLedgerService";
import { SharedExpense } from "../../domain/entities/SharedExpense";
import { SharedSettlement } from "../../domain/entities/SharedSettlement";
import { Transaction } from "../../domain/entities/Transaction";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedSettlementRepository } from "../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";

const userId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const ana = "019576a0-d7b6-7d6d-af6a-2b7545f5aca1";
const OLDER = "019576a0-d7b6-7d6d-af6a-2b7545f5ae01";
const NEWER = "019576a0-d7b6-7d6d-af6a-2b7545f5ae02";
const ACCOUNT = "019576a0-d7b6-7d6d-af6a-2b7545f5ae09";

const withAna = { kind: "CONTACT" as const, contactId: ana, expenseId: null };

const expense = (
  id: string,
  day: string,
  amount: number,
  collected = 0,
): SharedExpense =>
  new SharedExpense({
    id,
    groupId: "019576a0-d7b6-7d6d-af6a-2b7545f5ab00",
    description: `Line ${id.slice(-1)}`,
    date: new Date(`2026-08-${day}T18:00:00.000Z`),
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
          collected,
        },
      ],
    },
  });

const movementOf = (expenseId: string, amount: number): Transaction =>
  new Transaction({
    id: `tx-${expenseId}`,
    type: "EXPENSE",
    amount,
    date: new Date("2026-08-10T18:00:00.000Z"),
    fromAccountId: ACCOUNT,
    userId,
    currency: "COP",
    sharedExpenseId: expenseId,
    sharedGroupId: "019576a0-d7b6-7d6d-af6a-2b7545f5ab00",
  });

const paymentOf = (collected: number): SharedSettlement =>
  new SharedSettlement({
    userId,
    counterparty: withAna,
    date: new Date("2026-08-25T18:00:00.000Z"),
    collected,
    currency: "COP",
  });

describe("SharedLedgerService", () => {
  let expenses: jest.Mocked<ISharedExpenseRepository>;
  let settlements: jest.Mocked<ISharedSettlementRepository>;
  let transactions: jest.Mocked<ITransactionRepository>;
  let ledger: SharedLedgerService;

  beforeEach(() => {
    expenses = {
      getAll: jest.fn(),
      getAllByGroup: jest.fn(),
      getById: jest.fn(),
      getByIdIncludingDeleted: jest.fn(),
      getOwnById: jest.fn(),
      listByGroup: jest.fn().mockResolvedValue([]),
      listByCounterparty: jest.fn().mockResolvedValue([]),
      countSharesOfContact: jest.fn().mockResolvedValue(0),
      totalsByGroup: jest.fn().mockResolvedValue([]),
      replaceSplits: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ISharedExpenseRepository>;
    settlements = {
      getAll: jest.fn(),
      getAllByUserId: jest.fn(),
      getById: jest.fn(),
      getOwnById: jest.fn(),
      listByCounterparty: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ISharedSettlementRepository>;
    transactions = {
      listBySharedExpenseIds: jest.fn().mockResolvedValue([]),
      applySharedChange: jest.fn(),
    } as unknown as jest.Mocked<ITransactionRepository>;
    ledger = new SharedLedgerService(expenses, settlements, transactions);
  });

  const recompute = async (): Promise<RecomputeResult> =>
    ledger.recompute(userId, [withAna], "PAYMENT", "session" as never);

  it("covers the oldest line first and leaves the rest of the money on the next", async () => {
    expenses.listByCounterparty.mockResolvedValue([
      expense(NEWER, "20", 60_000),
      expense(OLDER, "10", 90_000),
    ]);
    settlements.listByCounterparty.mockResolvedValue([paymentOf(60_000)]);

    await recompute();

    const [written] = expenses.replaceSplits.mock.calls;
    const byId = new Map(
      (written?.[0] ?? []).map((one) => [
        one.id,
        one.split.shares.find((share) => share.contactId === ana)?.collected,
      ]),
    );
    // Her share of the older line is 45.000, so 15.000 reach the newer one.
    expect(byId.get(OLDER)).toBe(45_000);
    expect(byId.get(NEWER)).toBe(15_000);
  });

  it("writes what that leaves as yours on the movement, and says why", async () => {
    expenses.listByCounterparty.mockResolvedValue([
      expense(OLDER, "10", 90_000),
    ]);
    settlements.listByCounterparty.mockResolvedValue([paymentOf(30_000)]);
    transactions.listBySharedExpenseIds.mockResolvedValue([
      movementOf(OLDER, 90_000),
    ]);

    await recompute();

    expect(transactions.applySharedChange).toHaveBeenCalledWith(
      `tx-${OLDER}`,
      userId,
      expect.objectContaining({ countsAsYours: 60_000 }),
      expect.objectContaining({ reason: "PAYMENT", countsAsYours: 60_000 }),
      "session",
    );
  });

  it("keeps what could not be imputed as their surplus, and writes no figure", async () => {
    expenses.listByCounterparty.mockResolvedValue([
      expense(OLDER, "10", 90_000, 45_000),
    ]);
    settlements.listByCounterparty.mockResolvedValue([paymentOf(60_000)]);

    const { surplus } = await recompute();

    expect(surplus.get(`contact:${ana}`)).toEqual({ theirs: 15_000, yours: 0 });
    // Her share was already settled in full, so nothing was rewritten.
    expect(expenses.replaceSplits).not.toHaveBeenCalled();
    expect(transactions.applySharedChange).not.toHaveBeenCalled();
  });

  it("names everybody a line could be settled with, and never you", () => {
    expect(counterpartiesOf(expense(OLDER, "10", 90_000))).toEqual([
      { kind: "CONTACT", contactId: ana, expenseId: null },
    ]);
  });
});
