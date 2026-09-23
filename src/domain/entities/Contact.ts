import { v7 as uuidv7 } from "uuid";

import { Color } from "../../shared/constants";

export interface ContactProps {
  id?: string;
  name: string;
  color?: Color;
  // Identifier for inviting them later (T-129); nothing is sent from here.
  email?: string;
  userId: string;
  archivedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Contact {
  id: string;
  name: string;
  color?: Color;
  email?: string;
  userId: string;
  archivedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;

  constructor({
    id,
    name,
    color,
    email,
    userId,
    archivedAt,
    createdAt,
    updatedAt,
  }: ContactProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.color = color;
    this.email = email;
    this.userId = userId;
    this.archivedAt = archivedAt ?? null;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
