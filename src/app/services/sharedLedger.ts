import {
  SharedHistoryEntry,
  Transaction,
} from "../../domain/entities/Transaction";
import {
  ITransactionRepository,
  SharedLinkPatch,
} from "../../domain/repositories/transaction/ITransactionRepository";
import {
  SHARED_HISTORY_REASONS,
  SharedHistoryReason,
} from "../../shared/constants";
import { TxSession } from "../../shared/unitOfWork";
import { RestampJournal } from "./restamps";

export interface SharedLink {
  sharedExpenseId: string | null;
  sharedGroupId: string | null;
}

/** What counts as yours after the event; only money moves it, and none of these is money. */
function figureAfter(
  movement: Transaction,
  reason: SharedHistoryReason,
): number {
  return reason === SHARED_HISTORY_REASONS.UNSPLIT
    ? movement.amount
    : movement.countsAsYours;
}

export async function stampSharedChange(
  repo: ITransactionRepository,
  session: TxSession,
  movement: Transaction,
  reason: SharedHistoryReason,
  journal: RestampJournal,
  link: SharedLink = {
    sharedExpenseId: movement.sharedExpenseId,
    sharedGroupId: movement.sharedGroupId,
  },
): Promise<Transaction> {
  const countsAsYours = figureAfter(movement, reason);
  const patch: SharedLinkPatch = { ...link, countsAsYours };
  const entry: SharedHistoryEntry = { at: new Date(), reason, countsAsYours };
  journal.note("transaction", movement);
  return repo.applySharedChange(
    movement.id,
    movement.userId,
    patch,
    entry,
    session,
  );
}
