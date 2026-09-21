import { v7 as uuidv7 } from "uuid";

import { Color, GroupSplitMode } from "../../shared/constants";

export interface SharedParticipant {
  // null is the user: they are a row of the group like everybody else.
  contactId: string | null;
  addedAt?: Date;
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
    this.userId = userId;
    this.currency = currency;
    this.archivedAt = archivedAt ?? null;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
