import {
  SharedExpense,
  SharedShare,
} from "../../domain/entities/SharedExpense";
import { SettlementCounterparty } from "../../domain/entities/SharedSettlement";
import { Transaction } from "../../domain/entities/Transaction";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { ISharedCounterpartyRepository } from "../../domain/repositories/sharedCounterparty/ISharedCounterpartyRepository";
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
import { Restamp, RestampJournal } from "./restamps";
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

export const counterpartyKey = (party: {
  contactId: string | null;
  expenseId: string | null;
}): string =>
  party.expenseId ? `guests:${party.expenseId}` : `contact:${party.contactId}`;

/** Who one share is owed by, or owed to. A block of guests is named by the expense it lives in. */
export function counterpartyOfShare(
  expense: SharedExpense,
  share: SharedShare,
): SettlementCounterparty | null {
  if (share.party === SHARE_PARTIES.GUESTS) {
    return {
      kind: SETTLEMENT_PARTIES.GUESTS,
      contactId: null,
      expenseId: expense.id,
    };
  }
  if (share.party === SHARE_PARTIES.CONTACT && share.contactId) {
    return {
      kind: SETTLEMENT_PARTIES.CONTACT,
      contactId: share.contactId,
      expenseId: null,
    };
  }
  return null;
}

/** Everybody a payment could be with over one expense; you are never one of them. */
export function counterpartiesOf(
  expense: SharedExpense,
): SettlementCounterparty[] {
  return expense.split.shares
    .map((share) => counterpartyOfShare(expense, share))
    .filter((party): party is SettlementCounterparty => party !== null);
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

// `collected` on a share is never typed: it is this answer, computed again on every write.
export class SharedLedgerService {
  constructor(
    private expenseRepo: ISharedExpenseRepository,
    private settlementRepo: ISharedSettlementRepository,
    private transactionRepo: ITransactionRepository,
    private accountRepo: IAccountRepository,
    private counterpartyRepo: ISharedCounterpartyRepository,
  ) {}

  async recompute(
    userId: string,
    counterparties: SettlementCounterparty[],
    reason: SharedHistoryReason,
    session: TxSession,
    journal: RestampJournal,
  ): Promise<RecomputeResult> {
    const unique = new Map<string, SettlementCounterparty>();
    for (const party of counterparties) {
      unique.set(counterpartyKey(party), party);
    }
    await this.claim(userId, [...unique.values()], session);

    const changes: ShareChange[] = [];
    const surplus = new Map<string, Surplus>();
    const touched = new Map<string, SharedExpense>();

    for (const [key, party] of unique) {
      const settlements = await this.settlementRepo.listByCounterparty(
        userId,
        party,
        session,
      );
      const expenses = await this.expenseRepo.listByCounterparty(
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

      // What you handed over covers your own lines first; whatever is left of it is their money
      // going back, so it comes off what they gave you before any of that is imputed.
      const yours = impute(yourLines, pools.youOwe);
      const returned = yours.surplus;
      const theirs = impute(theirLines, pools.theyOwe - returned);
      surplus.set(key, {
        theirs: fromCents(theirs.surplus),
        yours: fromCents(Math.max(0, returned - pools.theyOwe)),
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
      for (const expense of touched.values()) {
        journal.note("sharedExpense", expense);
      }
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
        journal,
      )) {
        stamped.add(id);
      }
    }
    return { changes, surplus, stamped };
  }

  /** Two writes with one person otherwise touch different rows, read the same payments and never conflict. */
  async claim(
    userId: string,
    parties: SettlementCounterparty[],
    session: TxSession,
  ): Promise<void> {
    await this.counterpartyRepo.claim(
      userId,
      [...new Set(parties.map(counterpartyKey))],
      session,
    );
  }

  // The expense and the movement are one fact: neither may state what the other does not.
  async restateExpense(
    before: Transaction,
    after: Transaction,
    sharedExpenseId: string,
    session: TxSession,
    journal: RestampJournal,
  ): Promise<Transaction> {
    const amountChanged = after.amount !== before.amount;
    // A payment covers the oldest line first, so a new date can move what it covers.
    const dateChanged = after.date.getTime() !== before.date.getTime();
    const restated =
      amountChanged || dateChanged || after.description !== before.description;
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
    journal.note("sharedExpense", expense);
    const saved = await this.expenseRepo.update(expense.id, write, session);
    if (!amountChanged && !dateChanged) return after;

    // What each person owes, or the order it is owed in, moved: impute the payments again.
    const { stamped } = await this.recompute(
      after.userId,
      counterpartiesOf(saved),
      amountChanged
        ? SHARED_HISTORY_REASONS.AMOUNT_CHANGED
        : SHARED_HISTORY_REASONS.REIMPUTED,
      session,
      journal,
    );
    if (!amountChanged)
      return stamped.has(saved.id)
        ? ((await this.transactionRepo.getBySharedExpenseId(
            after.userId,
            saved.id,
            session,
          )) ?? after)
        : after;
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
      journal,
    );
  }

  /**
   * A block of guests exists only inside its expense, so there is nowhere to
   * impute what it paid and nobody left to give it back to.
   */
  async assertNoGuestPayments(
    userId: string,
    expenseId: string,
    session: TxSession,
  ): Promise<void> {
    const paid = await this.settlementRepo.listByCounterparty(
      userId,
      {
        kind: SETTLEMENT_PARTIES.GUESTS,
        contactId: null,
        expenseId,
      },
      session,
    );
    if (paid.length > 0) {
      throw new ApiError(
        "BadRequest",
        "Its block of guests has paid: undo those payments first, and then this can go",
        "GUEST_BLOCK_HAS_PAYMENTS",
      );
    }
  }

  /** Deleting the movement takes its expense with it, and what was paid imputes over what is left. */
  async dropExpenseOf(
    movement: Transaction,
    sharedExpenseId: string,
    session: TxSession,
    journal: RestampJournal,
  ): Promise<void> {
    const expense = await this.expenseRepo.getById(sharedExpenseId, session);
    await this.assertNoGuestPayments(movement.userId, sharedExpenseId, session);
    await this.expenseRepo.delete(sharedExpenseId, session);
    if (!expense) return;
    await this.recompute(
      movement.userId,
      counterpartiesOf(new SharedExpense(expense)),
      SHARED_HISTORY_REASONS.REIMPUTED,
      session,
      journal,
    );
  }

  /** What the journal noted, stamped as it stands at the end of the write; the answered row is its own. */
  async restampsOf(
    userId: string,
    journal: RestampJournal,
    session: TxSession,
    answered?: { entity: Restamp["entity"]; id: string },
  ): Promise<Restamp[]> {
    if (journal.entries().length === 0) return [];
    const now = {
      account: await this.accountRepo.stampsOf(
        userId,
        journal.idsOf("account"),
        session,
      ),
      sharedExpense: await this.expenseRepo.stampsOf(
        userId,
        journal.idsOf("sharedExpense"),
        session,
      ),
      transaction: await this.transactionRepo.stampsOf(
        userId,
        journal.idsOf("transaction"),
        session,
      ),
    };
    const restamped: Restamp[] = [];
    for (const before of journal.entries()) {
      if (before.entity === answered?.entity && before.id === answered.id) {
        continue;
      }
      const updatedAt = now[before.entity].get(before.id);
      if (!updatedAt || updatedAt.getTime() === before.updatedAt.getTime()) {
        continue;
      }
      restamped.push({
        entity: before.entity,
        id: before.id,
        previousUpdatedAt: before.updatedAt,
        updatedAt,
      });
    }
    return restamped;
  }

  /** What is left of a line you fronted after what came back: the figure Stats and the budgets read. */
  private async writeFigures(
    userId: string,
    expenses: SharedExpense[],
    reason: SharedHistoryReason,
    session: TxSession,
    journal: RestampJournal,
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
        journal,
      );
      written.push(expense.id);
    }
    return written;
  }
}
