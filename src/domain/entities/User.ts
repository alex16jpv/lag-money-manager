import { v7 as uuidv7 } from "uuid";

import { DEFAULT_TIMEZONE } from "../../shared/timezone";

export interface UserProps {
  id?: string;
  name: string;
  email: string;
  password?: string;
  // Bumped on password change / logout-all to invalidate outstanding tokens.
  tokenVersion?: number;
  // IANA timezone; drives day/period boundaries for stats and budgets.
  timezone?: string;
  // Last session open (login/register); impossible to reconstruct later.
  lastLoginAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class User {
  id: string;
  name: string;
  email: string;
  password?: string;
  tokenVersion: number;
  timezone: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  constructor({
    id,
    name,
    email,
    password,
    tokenVersion,
    timezone,
    lastLoginAt,
    createdAt,
    updatedAt,
  }: UserProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.email = email;
    this.password = password;
    this.tokenVersion = tokenVersion ?? 0;
    this.timezone = timezone ?? DEFAULT_TIMEZONE;
    this.lastLoginAt = lastLoginAt ?? null;
    this.createdAt = createdAt ?? new Date();
    this.updatedAt = updatedAt ?? new Date();
  }
}
