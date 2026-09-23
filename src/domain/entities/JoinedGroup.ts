import { Color } from "../../shared/constants";
import { SharedExpense, SharedSplit } from "./SharedExpense";
import { DefaultSplit, SharedWriteOff } from "./SharedGroup";

export interface JoinedParticipantView {
  // null is the person who shared the group, exactly as in the owner's own rows.
  contactId: string | null;
  name: string;
  color: Color | null;
  you: boolean;
  joined: boolean;
}

/** A group somebody else shared with you: the shared layer, and nothing of anybody's ledger. */
export interface JoinedGroupView {
  id: string;
  invitationId: string;
  name: string;
  color: Color | null;
  currency: string;
  ownerName: string;
  participants: JoinedParticipantView[];
  defaultSplit: DefaultSplit;
  writeOffs: SharedWriteOff[];
  archivedAt: Date | null;
  createdAt?: Date;
  // For you: when anything you read here last changed, or when you joined, whichever is later.
  updatedAt: Date;
}

export interface JoinedExpenseView {
  id: string;
  groupId: string;
  description: string | null;
  date: Date;
  amount: number;
  paidByContactId: string | null;
  split: SharedSplit;
  customSplit: boolean;
  currency?: string;
  deletedAt: Date | null;
  createdAt?: Date;
  updatedAt: Date;
}

export const joinedExpenseView = (
  expense: SharedExpense,
  since: Date,
): JoinedExpenseView => ({
  id: expense.id,
  groupId: expense.groupId,
  description: expense.description,
  date: expense.date,
  amount: expense.amount,
  paidByContactId: expense.paidByContactId,
  split: expense.split,
  customSplit: expense.customSplit,
  currency: expense.currency,
  deletedAt: expense.deletedAt,
  createdAt: expense.createdAt,
  updatedAt: latest([expense.updatedAt, since]),
});

export function latest(dates: (Date | null | undefined)[]): Date {
  let at = 0;
  for (const date of dates) {
    if (date && date.getTime() > at) at = date.getTime();
  }
  return new Date(at);
}
