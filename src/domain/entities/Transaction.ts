import { v7 as uuidv7 } from "uuid";

import { TransactionSource, TransactionType } from "../../shared/constants";
import { MAX_AMOUNT } from "../../shared/money";
import { DomainValidationError } from "../errors";

export interface TransactionProps {
  id?: string;
  type: TransactionType;
  amount: number;
  date: Date | string;
  categoryId?: string | null;
  description?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  userId: string;
  tags?: string[];
  note?: string | null;
  pendingDetails?: boolean;
  source?: TransactionSource;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  date: Date;
  categoryId: string | null;
  description: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  userId: string;
  tags: string[];
  note: string | null;
  pendingDetails: boolean;
  source: TransactionSource;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: TransactionProps) {
    this.id = props.id ?? uuidv7();
    this.type = props.type;
    this.amount = props.amount;
    this.date = props.date instanceof Date ? props.date : new Date(props.date);
    this.categoryId = props.categoryId ?? null;
    this.description = props.description ?? null;
    this.fromAccountId = props.fromAccountId ?? null;
    this.toAccountId = props.toAccountId ?? null;
    this.userId = props.userId;
    this.tags = props.tags ?? [];
    this.note = props.note ?? null;
    this.pendingDetails = props.pendingDetails ?? false;
    this.source = props.source ?? "MANUAL";
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  // Called on create and on the update merge so a partial update can't leave an
  // inconsistent shape.
  assertValid(): void {
    if (!(this.amount > 0)) {
      throw new DomainValidationError("Amount must be greater than 0", "amount");
    }
    // Future-dated money would hit today's balance and future budget windows;
    // scheduled transactions will be their own feature, not raw future dates.
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
