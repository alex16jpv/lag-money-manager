import { Locale } from "../../../shared/locale";

// What Create account typed, kept until its code or link creates the account (decision 16).
export interface PendingSignUp {
  // SHA-256 of the token only the browser that typed the password holds.
  id: string;
  toHash: string;
  email: string;
  name: string;
  passwordHash: string;
  timezone?: string;
  currency?: string;
  locale?: Locale;
  // The account its code or link created; null until then.
  userId: string | null;
  // When its code opened the one session it can open.
  signedInAt: Date | null;
  expiresAt: Date;
}

export interface ISignUpRepository {
  // A new one for an address replaces the one before, whichever browser holds it.
  replace(pending: Omit<PendingSignUp, "userId" | "signedInAt">): Promise<void>;
  findLive(id: string, now: Date): Promise<PendingSignUp | null>;
  // Only one caller gets to create its account: null when another already claimed it.
  claimCreation(
    id: string,
    userId: string,
    now: Date,
  ): Promise<PendingSignUp | null>;
  releaseCreation(id: string, userId: string): Promise<void>;
  // True once, for the code that opens its session.
  markSignedIn(id: string, now: Date): Promise<boolean>;
}
