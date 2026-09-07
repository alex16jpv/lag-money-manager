import { v7 as uuidv7 } from "uuid";

import { AccountType, Color } from "../../shared/constants";

export interface AccountProps {
  id?: string;
  name: string;
  type: AccountType;
  balance?: number;
  // Balance at creation; fixed thereafter. Enables a future integrity check
  // (stored balance vs openingBalance + aggregated transaction effects).
  openingBalance?: number;
  color?: Color;
  userId: string;
  isDefault?: boolean;
  // ISO 4217; stamped by the server from the owner's currency at creation.
  currency?: string;
  archivedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  openingBalance: number;
  color?: Color;
  userId: string;
  isDefault: boolean;
  currency?: string;
  archivedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;

  constructor({
    id,
    name,
    type,
    balance,
    openingBalance,
    color,
    userId,
    isDefault,
    currency,
    archivedAt,
    createdAt,
    updatedAt,
  }: AccountProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.type = type;
    this.balance = balance ?? 0;
    this.openingBalance = openingBalance ?? this.balance;
    this.color = color;
    this.userId = userId;
    this.isDefault = isDefault ?? false;
    this.currency = currency;
    this.archivedAt = archivedAt ?? null;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
