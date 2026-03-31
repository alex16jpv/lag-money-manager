import { v7 as uuidv7 } from "uuid";

export interface CategoryProps {
  id?: string;
  name: string;
  emoji?: string;
  userId: string;
}

export class Category {
  id: string;
  name: string;
  emoji?: string;
  userId: string;

  constructor({ id, name, emoji, userId }: CategoryProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.emoji = emoji;
    this.userId = userId;
  }
}
