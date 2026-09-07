import { TransactionSource, TransactionType } from "../../shared/constants";

export interface CreateTransactionDTO {
  id?: string;
  type: TransactionType;
  amount: number;
  date: Date;
  categoryId?: string | null;
  description?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  userId: string;
  tags?: string[];
  note?: string | null;
  pendingDetails?: boolean;
  // Server-derived (quick-add sets QUICK); the schema never accepts it.
  source?: TransactionSource;
}

export interface UpdateTransactionDTO {
  id?: string;
  type?: TransactionType;
  amount?: number;
  date?: Date;
  categoryId?: string | null;
  description?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  tags?: string[];
  note?: string | null;
  pendingDetails?: boolean;
}

export interface QuickAddTransactionDTO {
  id?: string;
  amount: number;
  type?: TransactionType;
  date?: Date;
  categoryId?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  userId: string;
}
