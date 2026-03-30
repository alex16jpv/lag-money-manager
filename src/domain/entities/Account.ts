import { AccountType } from "../../shared/constants";

export interface AccountProps {
  id?: string;
  name: string;
  type: AccountType;
  balance?: number;
  userId: string;
}

export class Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  userId: string;

  constructor({ id, name, type, balance, userId }: AccountProps) {
    this.id = id!;
    this.name = name;
    this.type = type;
    this.balance = balance ?? 0;
    this.userId = userId;
  }
}
