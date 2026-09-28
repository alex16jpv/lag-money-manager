import { v7 as uuidv7 } from "uuid";

import { DEFAULT_CURRENCY } from "../../shared/currency";
import { DEFAULT_LOCALE, Locale } from "../../shared/locale";
import { DEFAULT_TIMEZONE } from "../../shared/timezone";

export interface FreshStartDetails {
  name: string;
  locale: Locale;
  currency: string;
  timezone: string;
}

// Opened by a reset of an account whose email was never confirmed and that holds something (decision 12).
export interface KeepOrStartFresh {
  askedAt: Date;
  accounts: number;
  transactions: number;
  // Set once Start fresh is chosen, so a retry after a failure resumes it instead of asking again.
  startFresh: StartFreshClaim | null;
}

// claimedUntil: one request erases at a time; a request that died frees it when the lease runs out.
export interface StartFreshClaim extends FreshStartDetails {
  claimedUntil: Date;
}

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
  // Set by the first confirmation and never cleared, unlike emailVerifiedAt.
  firstVerifiedAt?: Date | null;
  // An It wasn't me issued before it no longer works.
  emailChangedAt?: Date | null;
  emailChange?: PendingEmailChange | null;
  undoLinks?: UndoLink[];
  // A device token issued before it no longer marks a known device for new-sign-in.
  devicesResetAt?: Date | null;
  keepOrStartFresh?: KeepOrStartFresh | null;
  // When Start fresh last erased the account: a sync cursor from before it names rows that are gone.
  dataResetAt?: Date | null;
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
  firstVerifiedAt: Date | null;
  emailChangedAt: Date | null;
  emailChange: PendingEmailChange | null;
  undoLinks: UndoLink[];
  devicesResetAt: Date | null;
  keepOrStartFresh: KeepOrStartFresh | null;
  dataResetAt: Date | null;
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
    firstVerifiedAt,
    emailChangedAt,
    emailChange,
    undoLinks,
    devicesResetAt,
    keepOrStartFresh,
    dataResetAt,
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
    this.firstVerifiedAt = firstVerifiedAt ?? null;
    this.emailChangedAt = emailChangedAt ?? null;
    this.emailChange = emailChange ?? null;
    this.undoLinks = undoLinks ?? [];
    this.devicesResetAt = devicesResetAt ?? null;
    this.keepOrStartFresh = keepOrStartFresh ?? null;
    this.dataResetAt = dataResetAt ?? null;
    this.createdAt = createdAt ?? new Date();
    this.updatedAt = updatedAt ?? new Date();
  }
}
