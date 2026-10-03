import { v7 as uuidv7 } from "uuid";

import { DEFAULT_CURRENCY } from "../../shared/currency";
import { DEFAULT_LOCALE, Locale } from "../../shared/locale";
import { DEFAULT_TIMEZONE } from "../../shared/timezone";

// A new address waiting for its code: the account keeps its email until it is confirmed.
export interface PendingEmailChange {
  email: string;
  sentAt: Date;
  expiresAt: Date;
}

// An "Undo the change" link sent to an address the account had; while it works, that address stays the account's.
export interface UndoLink {
  email: string;
  tokenHash: string;
  expiresAt: Date;
}

// The "Restore account" link of account-deleted: it works for its 7 days even once the account is back.
export interface RestoreLink {
  tokenHash: string;
  expiresAt: Date;
}

export interface ConfirmDeadline {
  // The last day, "YYYY-MM-DD" in the account's time zone when the deadline was set.
  day: string;
  // The end of that day: from this instant the API asks for the confirmation first.
  endsAt: Date;
  remindedAt: Date | null;
  // One per deadline email, each for the address it went to.
  links: { email: string; tokenHash: string }[];
}

export interface UserProps {
  id?: string;
  name: string;
  email: string;
  password?: string;
  // Bumped on password change / logout-all to invalidate outstanding tokens.
  tokenVersion?: number;
  // IANA timezone; drives day/period boundaries for stats and budgets.
  timezone?: string;
  // ISO 4217, locked once the user has accounts: changing it with history needs multi-currency.
  currency?: string;
  // UI language (en | es). Follows the user across devices.
  locale?: Locale;
  // Last session open (login/register); impossible to reconstruct later.
  lastLoginAt?: Date | null;
  emailVerifiedAt?: Date | null;
  confirmDeadline?: ConfirmDeadline | null;
  emailChange?: PendingEmailChange | null;
  undoLinks?: UndoLink[];
  // A device token issued before it no longer marks a known device for new-sign-in.
  devicesResetAt?: Date | null;
  // When the account was last reset: a sync cursor from before it names rows that are gone.
  dataResetAt?: Date | null;
  deletedAt?: Date | null;
  // The end of the last day a deleted account is kept: the first nightly pass after it erases it.
  keptUntil?: Date | null;
  restoreLinks?: RestoreLink[];
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
  currency: string;
  locale: Locale;
  lastLoginAt: Date | null;
  emailVerifiedAt: Date | null;
  confirmDeadline: ConfirmDeadline | null;
  emailChange: PendingEmailChange | null;
  undoLinks: UndoLink[];
  devicesResetAt: Date | null;
  dataResetAt: Date | null;
  deletedAt: Date | null;
  keptUntil: Date | null;
  restoreLinks: RestoreLink[];
  createdAt: Date;
  updatedAt: Date;

  constructor({
    id,
    name,
    email,
    password,
    tokenVersion,
    timezone,
    currency,
    locale,
    lastLoginAt,
    emailVerifiedAt,
    confirmDeadline,
    emailChange,
    undoLinks,
    devicesResetAt,
    dataResetAt,
    deletedAt,
    keptUntil,
    restoreLinks,
    createdAt,
    updatedAt,
  }: UserProps) {
    this.id = id ?? uuidv7();
    this.name = name;
    this.email = email;
    this.password = password;
    this.tokenVersion = tokenVersion ?? 0;
    this.timezone = timezone ?? DEFAULT_TIMEZONE;
    this.currency = currency ?? DEFAULT_CURRENCY;
    this.locale = locale ?? DEFAULT_LOCALE;
    this.lastLoginAt = lastLoginAt ?? null;
    this.emailVerifiedAt = emailVerifiedAt ?? null;
    this.confirmDeadline = confirmDeadline ?? null;
    this.emailChange = emailChange ?? null;
    this.undoLinks = undoLinks ?? [];
    this.devicesResetAt = devicesResetAt ?? null;
    this.dataResetAt = dataResetAt ?? null;
    this.deletedAt = deletedAt ?? null;
    this.keptUntil = keptUntil ?? null;
    this.restoreLinks = restoreLinks ?? [];
    this.createdAt = createdAt ?? new Date();
    this.updatedAt = updatedAt ?? new Date();
  }
}
