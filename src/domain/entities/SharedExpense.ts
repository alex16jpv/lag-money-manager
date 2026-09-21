import { v7 as uuidv7 } from "uuid";

import { SharePartyKind, SplitMode } from "../../shared/constants";
import { MAX_AMOUNT } from "../../shared/money";
import { DomainValidationError } from "../errors";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface SharedShare {
  party: SharePartyKind;
  // Only on a CONTACT row; null on the user's row and on the guest block.
  contactId: string | null;
  // PERCENT only.
  percent: number | null;
  // EXACT always; FIXED_REST only on a pinned row.
  fixedAmount: number | null;
  // What the split resolved to, and the only figure anything downstream reads.
  amount: number;
  // How much of this share has been settled. Always the imputation of the live payments, never typed.
  collected: number;
}

export interface GuestBlock {
  count: number;
  name: string | null;
}

export interface SharedSplit {
  mode: SplitMode;
  // Guests belong to this expense alone: they are not contacts and not part of the group.
  guests: GuestBlock | null;
  shares: SharedShare[];
}

export interface SharedExpenseProps {
  id?: string;
  groupId: string;
  description?: string | null;
  date: Date;
  amount: number;
  // null is the user: a line somebody else paid is not the user's expense yet.
  paidByContactId?: string | null;
  split: SharedSplit;
  // Set by saving a split on this expense, cleared by going back to the group's.
  customSplit?: boolean;
  userId: string;
  currency?: string;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class SharedExpense {
  id: string;
  groupId: string;
  description: string | null;
  date: Date;
  amount: number;
  paidByContactId: string | null;
  split: SharedSplit;
  customSplit: boolean;
  userId: string;
  currency?: string;
  deletedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;

  constructor({
    id,
    groupId,
    description,
    date,
    amount,
    paidByContactId,
    split,
    customSplit,
    userId,
    currency,
    deletedAt,
    createdAt,
    updatedAt,
  }: SharedExpenseProps) {
    this.id = id ?? uuidv7();
    this.groupId = groupId;
    this.description = description ?? null;
    this.date = date;
    this.amount = amount;
    this.paidByContactId = paidByContactId ?? null;
    this.split = split;
    this.customSplit = customSplit ?? false;
    this.userId = userId;
    this.currency = currency;
    this.deletedAt = deletedAt ?? null;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  // Called on create and on the update merge so a partial update cannot leave an inconsistent shape.
  assertValid(): void {
    if (!(this.amount > 0)) {
      throw new DomainValidationError(
        "Amount must be greater than 0",
        "amount",
      );
    }
    if (this.amount > MAX_AMOUNT) {
      throw new DomainValidationError(
        `Amount must be at most ${MAX_AMOUNT}`,
        "amount",
      );
    }
    // The same window transactions use: a shared expense is money that already left somebody.
    if (this.date.getTime() > Date.now() + ONE_DAY_MS) {
      throw new DomainValidationError(
        "date cannot be more than 24 hours in the future",
        "date",
        "FUTURE_DATE",
      );
    }
  }
}
