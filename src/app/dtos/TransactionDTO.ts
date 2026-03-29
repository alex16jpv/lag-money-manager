import { TransactionType } from "../../shared/constants";

export interface CreateTransactionDTO {
  type: TransactionType;
  amount: number;
  date: Date;
  categoryId?: number | null;
  description?: string | null;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  userId: number;
  tags?: string | null;
  note?: string | null;
}

export interface UpdateTransactionDTO {
  id?: number;
  type?: TransactionType;
  amount?: number;
  date?: Date;
  categoryId?: number | null;
  description?: string | null;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  userId?: number;
  tags?: string | null;
  note?: string | null;
}
