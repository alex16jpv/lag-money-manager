import { User } from "../../domain/entities/User";
import { Locale } from "../../shared/locale";

export interface CreateUserDTO {
  name: string;
  email: string;
  password: string;
  timezone?: string;
  currency?: string;
  locale?: Locale;
}

export interface UpdateUserDTO {
  id?: string;
  name?: string;
  email?: string;
  password?: string;
  // Verification only; never persisted.
  currentPassword?: string;
  timezone?: string;
  currency?: string;
  locale?: Locale;
}

// What helps the owner of the inbox tell whether they created the account: never a name somebody typed.
export interface KeepOrStartFreshView {
  createdAt: Date;
  accounts: number;
  transactions: number;
}

export interface UserResponseDTO {
  id: string;
  name: string;
  email: string;
  timezone: string;
  currency: string;
  locale: Locale;
  lastLoginAt: Date | null;
  keepOrStartFresh: KeepOrStartFreshView | null;
  createdAt: Date;
  updatedAt: Date;
  // Present (true) only when register revived a soft-deleted account.
  reactivated?: boolean;
}

/** The user as every response prints them: the entity minus the credentials. */
export const toUserResponse = (user: User): UserResponseDTO => ({
  id: user.id,
  name: user.name,
  email: user.email,
  timezone: user.timezone,
  currency: user.currency,
  locale: user.locale,
  lastLoginAt: user.lastLoginAt,
  keepOrStartFresh: user.keepOrStartFresh
    ? {
        createdAt: user.createdAt,
        accounts: user.keepOrStartFresh.accounts,
        transactions: user.keepOrStartFresh.transactions,
      }
    : null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
