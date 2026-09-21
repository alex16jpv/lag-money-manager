import { v7 as uuidv7 } from "uuid";

import {
  Color,
  GroupSplitMode,
  SettlementPartyKind,
} from "../../shared/constants";

export interface SharedParticipant {
  // null is the user: they are a row of the group like everybody else.
  contactId: string | null;
  addedAt?: Date;
}

/**
 * Giving up on what somebody still owes here. It moves no figure — that money
 * was counted as yours the day it left — so what is stored is the decision,
 * and what is owed follows the share down if it ever falls.
 */
export interface SharedWriteOff {
  kind: SettlementPartyKind;
  contactId: string | null;
  // GUESTS only: the expense the block lives in.
  expenseId: string | null;
  at: Date;
}

export interface DefaultSplitShare {
  contactId: string | null;
  percent: number;
}

export interface DefaultSplit {
  mode: GroupSplitMode;
  // PERCENT only, one entry per participant; empty under EQUAL.
  shares: DefaultSplitShare[];
}

export interface SharedGroupProps {
  id?: string;
  name: string;
  color?: Color;
  participants?: SharedParticipant[];
  defaultSplit?: DefaultSplit;
  writeOffs?: SharedWriteOff[];
  userId: string;
  // ISO 4217; stamped by the server from the owner's currency at creation.
  currency?: string;
  archivedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class SharedGroup {
  id: string;
  name: string;
  color?: Color;
  participants: SharedParticipant[];
  defaultSplit: DefaultSplit;
  writeOffs: SharedWriteOff[];
  userId: string;
  currency?: string;
  archivedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;

  constructor({
    id,
    name,
    color,
    participants,
    defaultSplit,
    writeOffs,
    userId,
    currency,
    archivedAt,
    createdAt,
    updatedAt,
  }: SharedGroupProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.color = color;
    this.participants = participants ?? [{ contactId: null }];
    this.defaultSplit = defaultSplit ?? { mode: "EQUAL", shares: [] };
    this.writeOffs = writeOffs ?? [];
    this.userId = userId;
    this.currency = currency;
    this.archivedAt = archivedAt ?? null;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
