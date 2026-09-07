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

export interface UserResponseDTO {
  id: string;
  name: string;
  email: string;
  timezone: string;
  currency: string;
  locale: Locale;
  lastLoginAt: Date | null;
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
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
