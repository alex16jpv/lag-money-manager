import { v7 as uuidv7 } from "uuid";

import { Color } from "../../shared/constants";

export interface ContactProps {
  id?: string;
  name: string;
  color?: Color;
  // Identifier for inviting them later (T-129); nothing is sent from here.
  email?: string;
  // Reserved for the invited user who accepted (T-129); never settable by a client.
  linkedUserId?: string | null;
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
  linkedUserId: string | null;
  userId: string;
  archivedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;

  constructor({
    id,
    name,
    color,
    email,
    linkedUserId,
    userId,
    archivedAt,
    createdAt,
    updatedAt,
  }: ContactProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.color = color;
    this.email = email;
    this.linkedUserId = linkedUserId ?? null;
    this.userId = userId;
    this.archivedAt = archivedAt ?? null;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}
