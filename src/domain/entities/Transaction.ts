import { DomainValidationError } from "../errors";
import { TRANSACTION_TYPES } from "../../shared/constants";

export interface TransactionProps {
  id?: number;
  type: keyof typeof TRANSACTION_TYPES;
  amount: number;
  date: Date | string;
  categoryId?: number | null;
  description?: string | null;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  userId: number;
  tags?: string | null;
  note?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Transaction {
  id: number;
  type: TransactionProps["type"];
  amount: number;
  date: Date;
  categoryId: number | null;
  description: string | null;
  fromAccountId: number | null;
  toAccountId: number | null;
  userId: number;
  tags: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: TransactionProps) {
    this.id = props.id!;
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
    this.createdAt = props.createdAt!;
    this.updatedAt = props.updatedAt!;
  }

  validate() {
    if (!this.type) {
      throw new DomainValidationError("'type' is required", "type");
    }

    if (!TRANSACTION_TYPES[this.type]) {
      throw new DomainValidationError(
        `Invalid transaction type. Available: ${Object.values(TRANSACTION_TYPES).join(", ")}`,
        "type",
      );
    }

    if (this.amount === undefined || this.amount === null) {
      throw new DomainValidationError("'amount' is required", "amount");
    }

    if (this.amount <= 0) {
      throw new DomainValidationError(
        "'amount' must be greater than 0",
        "amount",
      );
    }

    if (!this.date) {
      throw new DomainValidationError("'date' is required", "date");
    }

    if (!this.userId) {
      throw new DomainValidationError("'userId' is required", "userId");
    }

    if (this.type === "EXPENSE" && !this.fromAccountId) {
      throw new DomainValidationError(
        "'fromAccountId' is required for expense transactions",
        "fromAccountId",
      );
    }

    if (this.type === "INCOME" && !this.toAccountId) {
      throw new DomainValidationError(
        "'toAccountId' is required for income transactions",
        "toAccountId",
      );
    }

    if (this.type === "TRANSFER") {
      if (!this.fromAccountId) {
        throw new DomainValidationError(
          "'fromAccountId' is required for transfer transactions",
          "fromAccountId",
        );
      }
      if (!this.toAccountId) {
        throw new DomainValidationError(
          "'toAccountId' is required for transfer transactions",
          "toAccountId",
        );
      }
      if (this.fromAccountId === this.toAccountId) {
        throw new DomainValidationError(
          "'fromAccountId' and 'toAccountId' must be different",
          "toAccountId",
        );
      }
    }
  }
}
