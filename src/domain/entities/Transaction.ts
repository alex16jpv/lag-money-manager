import { TransactionType } from "../../shared/constants";

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
}
