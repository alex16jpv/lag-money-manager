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
    this.keepOrStartFresh = keepOrStartFresh ?? null;
    this.dataResetAt = dataResetAt ?? null;
    this.createdAt = createdAt ?? new Date();
    this.updatedAt = updatedAt ?? new Date();
  }
}
