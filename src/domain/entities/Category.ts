import { v7 as uuidv7 } from "uuid";

import { CategoryType, Color } from "../../shared/constants";

export interface CategoryProps {
  id?: string;
  name: string;
  emoji?: string;
  color?: Color;
  type?: CategoryType;
  userId: string;
}

export class Category {
  id: string;
  name: string;
  emoji?: string;
  color?: Color;
  type?: CategoryType;
  userId: string;

  constructor({ id, name, emoji, color, type, userId }: CategoryProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.emoji = emoji;
    this.color = color;
    this.type = type;
    this.userId = userId;
  }
}
