import { v7 as uuidv7 } from "uuid";

import { TransactionType } from "../../shared/constants";
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
  tags?: string | null;
  note?: string | null;
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
  tags: string | null;
  note: string | null;
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
    this.tags = props.tags ?? null;
    this.note = props.note ?? null;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  /**
   * Enforces the type/account invariants of a transaction. Called on create and
   * on the result of an update merge, so a partial update can never leave a
   * transaction in an inconsistent shape (e.g. an INCOME with no destination
   * account, or a TRANSFER to the same account) — the bug class that historically
   * let updates corrupt balances.
   */
  assertValid(): void {
    if (!(this.amount > 0)) {
      throw new DomainValidationError("Amount must be greater than 0", "amount");
    }
    if (this.amount > MAX_AMOUNT) {
      throw new DomainValidationError(
        `Amount must be at most ${MAX_AMOUNT}`,
        "amount",
      );
    }
    if (this.type === "EXPENSE" && !this.fromAccountId) {
      throw new DomainValidationError(
        "fromAccountId is required for expense transactions",
        "fromAccountId",
      );
    }
    if (this.type === "INCOME" && !this.toAccountId) {
      throw new DomainValidationError(
        "toAccountId is required for income transactions",
        "toAccountId",
      );
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
