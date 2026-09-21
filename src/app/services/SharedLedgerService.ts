import {
  SharedExpense,
  SharedShare,
} from "../../domain/entities/SharedExpense";
import { SettlementCounterparty } from "../../domain/entities/SharedSettlement";
import { Transaction } from "../../domain/entities/Transaction";
import { ISharedExpenseRepository } from "../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { ISharedSettlementRepository } from "../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import {
  SETTLEMENT_PARTIES,
  SHARE_PARTIES,
  SHARED_HISTORY_REASONS,
  SharedHistoryReason,
} from "../../shared/constants";
import { DEFAULT_CURRENCY } from "../../shared/currency";
import { ApiError } from "../../shared/errors";
import { fromCents, toCents } from "../../shared/money";
import { impute, OwedLine } from "../../shared/sharedImputation";
import { TxSession } from "../../shared/unitOfWork";
import { stampSharedChange } from "./sharedLedger";
import { resplitForNewAmount } from "./sharedSplitting";

/** What one share of one expense went from and to, so the caller can record what it just covered. */
export interface ShareChange {
  expenseId: string;
  description: string | null;
  date: Date;
  party: SharedShare["party"];
  contactId: string | null;
  before: number;
  after: number;
}

/** Money handed over that nothing was owed for, which is the other one's to get back. */
export interface Surplus {
  theirs: number;
  yours: number;
}

export interface RecomputeResult {
  changes: ShareChange[];
  surplus: Map<string, Surplus>;
  // The expenses whose movement was written, so a caller does not say it twice.
  stamped: Set<string>;
}

export const counterpartyKey = (party: SettlementCounterparty): string =>
  party.kind === SETTLEMENT_PARTIES.CONTACT
    ? `contact:${party.contactId}`
    : `guests:${party.expenseId}`;

/** Everybody a payment could be with over one expense; you are never one of them. */
export function counterpartiesOf(
  expense: SharedExpense,
): SettlementCounterparty[] {
  const parties: SettlementCounterparty[] = [];
  for (const share of expense.split.shares) {
    if (share.party === SHARE_PARTIES.CONTACT && share.contactId) {
      parties.push({
        kind: SETTLEMENT_PARTIES.CONTACT,
        contactId: share.contactId,
        expenseId: null,
      });
    }
    if (share.party === SHARE_PARTIES.GUESTS) {
      parties.push({
        kind: SETTLEMENT_PARTIES.GUESTS,
        contactId: null,
        expenseId: expense.id,
      });
    }
  }
  return parties;
}

const isTheirs = (
  share: SharedShare,
  party: SettlementCounterparty,
): boolean =>
  party.kind === SETTLEMENT_PARTIES.CONTACT
    ? share.party === SHARE_PARTIES.CONTACT &&
      share.contactId === party.contactId
    : share.party === SHARE_PARTIES.GUESTS;

const isYours = (share: SharedShare): boolean =>
  share.party === SHARE_PARTIES.USER;

/**
 * The one place that decides what a payment covers and what that leaves as
 * yours. A payment belongs to the person, so it is imputed over everything
 * open with them, oldest line first, and every change imputes it again from
 * scratch: `collected` on a share is never typed, it is always the answer.
 */
export class SharedLedgerService {
  constructor(
    private expenseRepo: ISharedExpenseRepository,
    private settlementRepo: ISharedSettlementRepository,
    private transactionRepo: ITransactionRepository,
  ) {}

  async recompute(
    userId: string,
    counterparties: SettlementCounterparty[],
    reason: SharedHistoryReason,
    session: TxSession,
  ): Promise<RecomputeResult> {
    const unique = new Map<string, SettlementCounterparty>();
    for (const party of counterparties) {
      unique.set(counterpartyKey(party), party);
    }

    const changes: ShareChange[] = [];
    const surplus = new Map<string, Surplus>();
    const touched = new Map<string, SharedExpense>();

    for (const [key, party] of unique) {
      const expenses = await this.expenseRepo.listByCounterparty(
        userId,
        party,
        session,
      );
      const settlements = await this.settlementRepo.listByCounterparty(
        userId,
        party,
        session,
      );
      const pools = {
        theyOwe: settlements.reduce(
          (sum, one) => sum + toCents(one.collected),
          0,
        ),
        youOwe: settlements.reduce((sum, one) => sum + toCents(one.paid), 0),
      };

      const theirLines: OwedLine[] = [];
      const yourLines: OwedLine[] = [];
      for (const expense of expenses) {
        const theirs = expense.split.shares.find((share) =>
          isTheirs(share, party),
        );
        // You fronted it, so their share is what they owe you.
        if (expense.paidByContactId === null && theirs) {
          theirLines.push({
            key: expense.id,
            date: expense.date,
            owed: toCents(theirs.amount),
          });
        }
        const yours = expense.split.shares.find(isYours);
        // They fronted it, so your share is what you owe them.
        if (
          party.kind === SETTLEMENT_PARTIES.CONTACT &&
          expense.paidByContactId === party.contactId &&
          yours
        ) {
          yourLines.push({
            key: expense.id,
            date: expense.date,
            owed: toCents(yours.amount),
          });
        }
      }

      const theirs = impute(theirLines, pools.theyOwe);
      const yours = impute(yourLines, pools.youOwe);
      surplus.set(key, {
        theirs: fromCents(theirs.surplus),
        yours: fromCents(yours.surplus),
      });

      for (const expense of expenses) {
        const settledByThem = theirs.settled.get(expense.id);
        const settledByYou = yours.settled.get(expense.id);
        const shares = expense.split.shares.map((share) => {
          const after =
            settledByThem !== undefined && isTheirs(share, party)
              ? settledByThem
              : settledByYou !== undefined && isYours(share)
                ? settledByYou
                : undefined;
          if (after === undefined) return share;
          const before = toCents(share.collected);
          if (before === after) return share;
          changes.push({
            expenseId: expense.id,
            description: expense.description,
            date: expense.date,
            party: share.party,
            contactId: share.contactId,
            before: fromCents(before),
            after: fromCents(after),
          });
          return { ...share, collected: fromCents(after) };
        });
        if (
          shares.some((share, index) => share !== expense.split.shares[index])
        ) {
          touched.set(
            expense.id,
            new SharedExpense({
              ...expense,
              split: { ...expense.split, shares },
            }),
          );
        }
      }
    }

    const stamped = new Set<string>();
    if (touched.size > 0) {
      await this.expenseRepo.replaceSplits(
        [...touched.values()].map((expense) => ({
          id: expense.id,
          split: expense.split,
        })),
        session,
      );
      for (const id of await this.writeFigures(
        userId,
        [...touched.values()],
        reason,
        session,
      )) {
        stamped.add(id);
      }
    }
    return { changes, surplus, stamped };
  }

  /**
   * The expense in the shared group is the same fact as the movement. A new
   * amount resolves the split again; an EXACT split states amounts rather than
   * proportions, so it stops adding up and the edit is refused.
   */
  async restateExpense(
    before: Transaction,
    after: Transaction,
    sharedExpenseId: string,
    session: TxSession,
  ): Promise<Transaction> {
    const amountChanged = after.amount !== before.amount;
    const restated =
      amountChanged ||
      after.date.getTime() !== before.date.getTime() ||
      after.description !== before.description;
    if (!restated) return after;

    const expense = await this.expenseRepo.getById(sharedExpenseId, session);
    if (!expense) {
      throw new ApiError(
        "InternalServerError",
        "The shared expense this transaction belongs to is missing",
      );
    }
    const write: Partial<SharedExpense> = {
      amount: after.amount,
      date: after.date,
      description: after.description,
    };
    if (amountChanged) {
      write.split = resplitForNewAmount({
        split: expense.split,
        amount: after.amount,
        currency: expense.currency ?? DEFAULT_CURRENCY,
        paidByContactId: expense.paidByContactId,
      });
    }
    const saved = await this.expenseRepo.update(expense.id, write, session);
    if (!amountChanged) return after;

    // What each person owes moved, so their payments are imputed over it again.
    const { stamped } = await this.recompute(
      after.userId,
      counterpartiesOf(saved),
      SHARED_HISTORY_REASONS.AMOUNT_CHANGED,
      session,
    );
    if (stamped.has(saved.id)) {
      const written = await this.transactionRepo.getBySharedExpenseId(
        after.userId,
        saved.id,
        session,
      );
      if (written) return written;
    }
    return stampSharedChange(
      this.transactionRepo,
      session,
      after,
      SHARED_HISTORY_REASONS.AMOUNT_CHANGED,
    );
  }

  /** Deleting the movement takes its expense with it, and what was paid imputes over what is left. */
  async dropExpenseOf(
    movement: Transaction,
    sharedExpenseId: string,
    session: TxSession,
  ): Promise<void> {
    const expense = await this.expenseRepo.getById(sharedExpenseId, session);
    await this.expenseRepo.delete(sharedExpenseId, session);
    if (!expense) return;
    await this.recompute(
      movement.userId,
      counterpartiesOf(new SharedExpense(expense)),
      SHARED_HISTORY_REASONS.REIMPUTED,
      session,
    );
  }

  /** What is left of a line you fronted after what came back: the figure Stats and the budgets read. */
  private async writeFigures(
    userId: string,
    expenses: SharedExpense[],
    reason: SharedHistoryReason,
    session: TxSession,
  ): Promise<string[]> {
    const written: string[] = [];
    const yours = expenses.filter(
      (expense) => expense.paidByContactId === null,
    );
    if (yours.length === 0) return written;
    const movements = await this.transactionRepo.listBySharedExpenseIds(
      userId,
      yours.map((expense) => expense.id),
      session,
    );
    const byExpense = new Map(
      movements.map((movement) => [movement.sharedExpenseId, movement]),
    );
    for (const expense of yours) {
      const movement = byExpense.get(expense.id);
      if (!movement) continue;
      const cameBack = expense.split.shares
        .filter((share) => !isYours(share))
        .reduce((sum, share) => sum + toCents(share.collected), 0);
      const countsAsYours = fromCents(toCents(expense.amount) - cameBack);
      if (countsAsYours === movement.countsAsYours) continue;
      await stampSharedChange(
        this.transactionRepo,
        session,
        Object.assign(movement, { countsAsYours }),
        reason,
      );
      written.push(expense.id);
    }
    return written;
  }
}
