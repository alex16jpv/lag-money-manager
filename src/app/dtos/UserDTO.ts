import { User } from "../../domain/entities/User";
import { ENVIRONMENT } from "../../shared/constants";
import { Locale } from "../../shared/locale";
import { Theme } from "../../shared/theme";

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
  password?: string;
  // Verification only; never persisted.
  currentPassword?: string;
  timezone?: string;
  currency?: string;
  locale?: Locale;
  theme?: Theme;
}

// For the sheet that confirms the email: which of its two shapes, and when Resend can go.
export interface EmailVerificationView {
  codeLive: boolean;
  lastSentAt: Date | null;
  resendAvailableAt: Date | null;
}

export interface EmailChangeView {
  email: string;
  expiresAt: Date;
  resendAvailableAt: Date | null;
}

export interface UserResponseDTO {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  // Only for an account from before email existed that has a deadline: its last day, in its time zone.
  confirmBy: string | null;
  // Past that deadline: everything but confirming waits (EMAIL_CONFIRMATION_REQUIRED).
  emailConfirmationRequired: boolean;
  timezone: string;
  currency: string;
  locale: Locale;
  theme: Theme | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// What Sign in answers for the right password of a deleted account: days in its time zone.
export interface DeletedAccountView {
  deletedOn: string;
  keptUntil: string;
}

/** The user as every response prints them: the entity minus the credentials. */
export const toUserResponse = (
  user: User,
  now: Date = new Date(),
): UserResponseDTO => {
  const deadline = user.emailVerifiedAt ? null : user.confirmDeadline;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    confirmBy: deadline?.day ?? null,
    emailConfirmationRequired:
      ENVIRONMENT.EMAIL_CONFIRMATION_DEADLINES === true &&
      !!deadline &&
      now >= deadline.endsAt,
    timezone: user.timezone,
    currency: user.currency,
    locale: user.locale,
    theme: user.theme,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};
