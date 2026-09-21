import { v7 as uuidv7 } from "uuid";

import {
  SharedHistoryReason,
  TransactionSource,
  TransactionType,
} from "../../shared/constants";
import { currencyDecimals } from "../../shared/currency";
import { hasValidPrecision, MAX_AMOUNT } from "../../shared/money";
import { DomainValidationError } from "../errors";

/** One line of why what counts as yours is what it is; an event that moved it nowhere repeats the figure. */
export interface SharedHistoryEntry {
  at: Date;
  reason: SharedHistoryReason;
  countsAsYours: number;
}

export interface TransactionProps {
  id?: string;
  type: TransactionType;
  amount: number;
  date: Date | string;
  // Stamped by the service from the account's timezone; only a change of `date` may move it.
  dayKey?: string | null;
  categoryId?: string | null;
  description?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  userId: string;
  tags?: string[];
  note?: string | null;
  pendingDetails?: boolean;
  source?: TransactionSource;
  // ISO 4217; stamped from the involved account when balances are applied.
  currency?: string;
  // The figure Stats and the budgets measure: the amount minus whatever came back. Defaults to the amount.
  countsAsYours?: number;
  sharedExpenseId?: string | null;
  sharedGroupId?: string | null;
  sharedHistory?: SharedHistoryEntry[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  date: Date;
  dayKey: string | null;
  categoryId: string | null;
  description: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  userId: string;
  tags: string[];
  note: string | null;
  pendingDetails: boolean;
  source: TransactionSource;
  currency?: string;
  countsAsYours: number;
  sharedExpenseId: string | null;
  sharedGroupId: string | null;
  sharedHistory: SharedHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;

  constructor(props: TransactionProps) {
    this.id = props.id ?? uuidv7();
    this.type = props.type;
    this.amount = props.amount;
    this.date = props.date instanceof Date ? props.date : new Date(props.date);
    this.dayKey = props.dayKey ?? null;
    this.categoryId = props.categoryId ?? null;
    this.description = props.description ?? null;
    this.fromAccountId = props.fromAccountId ?? null;
    this.toAccountId = props.toAccountId ?? null;
    this.userId = props.userId;
    this.tags = props.tags ?? [];
    this.note = props.note ?? null;
    this.pendingDetails = props.pendingDetails ?? false;
    this.source = props.source ?? "MANUAL";
    this.currency = props.currency;
    this.countsAsYours = props.countsAsYours ?? props.amount;
    this.sharedExpenseId = props.sharedExpenseId ?? null;
    this.sharedGroupId = props.sharedGroupId ?? null;
    this.sharedHistory = props.sharedHistory ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  /**
   * Zod caps every amount at 2 decimals; currencies with no minor unit
   * (JPY, CLP, KRW...) need the stricter rule. Separate from assertValid
   * because the currency is stamped from the account, which the service only
   * reads later. `assertValid` does NOT call it (T-67): precision is a rule
   * about the amount being written, and a row stored before the rule tightened
   * must stay editable in everything but its amount — `adjustBalances` asserts
   * it whenever money is applied forward, which is every path that writes one.
   */
  assertValidPrecision(): void {
    const decimals = currencyDecimals(this.currency);
    if (!hasValidPrecision(this.amount, decimals)) {
      throw new DomainValidationError(
        decimals === 0
          ? `${this.currency} amounts cannot have decimals`
          : `Amount must have at most ${decimals} decimal places`,
        "amount",
        "AMOUNT_PRECISION",
      );
    }
  }

  // Called on create and on the update merge so a partial update cannot leave an inconsistent shape.
  assertValid(): void {
    if (!(this.amount > 0)) {
      throw new DomainValidationError(
        "Amount must be greater than 0",
        "amount",
      );
    }
    // Future-dated money would hit today's balance; scheduling will be its own feature.
    if (this.date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new DomainValidationError(
        "date cannot be more than 24 hours in the future",
        "date",
        "FUTURE_DATE",
      );
    }
    if (this.amount > MAX_AMOUNT) {
      throw new DomainValidationError(
        `Amount must be at most ${MAX_AMOUNT}`,
        "amount",
      );
    }
    if (this.countsAsYours < 0 || this.countsAsYours > this.amount) {
      throw new DomainValidationError(
        "What counts as yours is between zero and the amount",
        "countsAsYours",
      );
    }
    if ((this.sharedExpenseId === null) !== (this.sharedGroupId === null)) {
      throw new DomainValidationError(
        "A shared transaction names both its group and its expense",
        "sharedExpenseId",
      );
    }
    if (this.sharedExpenseId && this.type !== "EXPENSE") {
      throw new DomainValidationError(
        "Only an expense can be split with other people",
        "type",
        "TRANSACTION_NOT_SPLITTABLE",
      );
    }
    if (this.type === "EXPENSE") {
      if (!this.fromAccountId) {
        throw new DomainValidationError(
          "fromAccountId is required for expense transactions",
          "fromAccountId",
        );
      }
      if (this.toAccountId) {
        throw new DomainValidationError(
          "toAccountId is not allowed for expense transactions",
          "toAccountId",
        );
      }
    }
    if (this.type === "INCOME") {
      if (!this.toAccountId) {
        throw new DomainValidationError(
          "toAccountId is required for income transactions",
          "toAccountId",
        );
      }
      if (this.fromAccountId) {
        throw new DomainValidationError(
          "fromAccountId is not allowed for income transactions",
          "fromAccountId",
        );
      }
    }
    if (this.type === "ADJUSTMENT") {
      const sides = [this.fromAccountId, this.toAccountId].filter(Boolean);
      if (sides.length !== 1) {
        throw new DomainValidationError(
          "Adjustment requires exactly one of fromAccountId (decrease) or toAccountId (increase)",
          "fromAccountId",
        );
      }
      if (this.categoryId) {
        throw new DomainValidationError(
          "categoryId is not allowed for adjustment transactions",
          "categoryId",
        );
      }
    }
    if (this.type === "TRANSFER") {
      if (!this.fromAccountId) {
        throw new DomainValidationError(
          "fromAccountId is required for transfer transactions",
          "fromAccountId",
        );
      }
      if (!this.toAccountId) {
        throw new DomainValidationError(
          "toAccountId is required for transfer transactions",
          "toAccountId",
        );
      }
      if (this.fromAccountId === this.toAccountId) {
        throw new DomainValidationError(
          "fromAccountId and toAccountId must be different",
          "toAccountId",
        );
      }
    }
  }
}
