import { v7 as uuidv7 } from "uuid";
import { AccountType, Color } from "../../shared/constants";

export interface AccountProps {
  id?: string;
  name: string;
  type: AccountType;
  balance?: number;
  color?: Color;
  userId: string;
}

export class Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  color?: Color;
  userId: string;

  constructor({ id, name, type, balance, color, userId }: AccountProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.type = type;
    this.balance = balance ?? 0;
    this.color = color;
    this.userId = userId;
  }
}
