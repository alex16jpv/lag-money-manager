import { v7 as uuidv7 } from "uuid";

import { CategoryType, Color } from "../../shared/constants";

export interface CategoryProps {
  id?: string;
  name: string;
  emoji?: string;
  color?: Color;
  type?: CategoryType;
  userId: string;
  // Stable identity of a seeded default; survives renames (enables re-seed).
  seedKey?: string;
  archivedAt?: Date | null;
}

export class Category {
  id: string;
  name: string;
  emoji?: string;
  color?: Color;
  type?: CategoryType;
  userId: string;
  seedKey?: string;
  archivedAt: Date | null;

  constructor({ id, name, emoji, color, type, userId, seedKey, archivedAt }: CategoryProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.emoji = emoji;
    this.color = color;
    this.type = type;
    this.userId = userId;
    this.seedKey = seedKey;
    this.archivedAt = archivedAt ?? null;
  }
}
