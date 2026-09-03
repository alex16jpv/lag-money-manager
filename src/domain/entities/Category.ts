import { v7 as uuidv7 } from "uuid";

import { CategoryType, Color } from "../../shared/constants";
import { CategoryIcon } from "../../shared/icons";

export interface CategoryProps {
  id?: string;
  name: string;
  // Lucide key from CATEGORY_ICONS (replaced the free-text emoji, 2026-09).
  icon?: CategoryIcon;
  color?: Color;
  type?: CategoryType;
  userId: string;
  // Stable identity of a seeded default; survives renames (enables re-seed).
  seedKey?: string;
  archivedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Category {
  id: string;
  name: string;
  icon?: CategoryIcon;
  color?: Color;
  type?: CategoryType;
  userId: string;
  seedKey?: string;
  archivedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;

  constructor({
    id,
    name,
    icon,
    color,
    type,
    userId,
    seedKey,
    archivedAt,
    createdAt,
    updatedAt,
  }: CategoryProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.icon = icon;
    this.color = color;
    this.type = type;
    this.userId = userId;
    this.seedKey = seedKey;
    this.archivedAt = archivedAt ?? null;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
