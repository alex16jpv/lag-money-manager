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
