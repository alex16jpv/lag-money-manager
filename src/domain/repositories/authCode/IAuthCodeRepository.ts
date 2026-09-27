import { AuthCodePurpose } from "../../../shared/constants";

export interface IssuedCode {
  codeHash: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AuthCodeRecord {
  id: string;
  purpose: AuthCodePurpose;
  // SHA-256 of the normalized address: one row per address and purpose, account or not.
  toHash: string;
  userId: string | null;
  codes: IssuedCode[];
  attempts: number;
}

export interface IAuthCodeRepository {
  // Upserts the address's row and starts its tries again, so an address with no account leaves the same trace.
  recordRequest(
    purpose: AuthCodePurpose,
    toHash: string,
    userId: string | null,
    expiresAt: Date,
  ): Promise<void>;

  // keepLive keeps the newest live code next to the new one: the email that carried it may still arrive.
  issue(
    purpose: AuthCodePurpose,
    toHash: string,
    code: IssuedCode,
    keepLive: boolean,
    now: Date,
  ): Promise<void>;

  // Counts one try atomically; null when the address has no row or its tries are spent.
  countAttempt(
    purpose: AuthCodePurpose,
    toHash: string,
    maxAttempts: number,
  ): Promise<AuthCodeRecord | null>;

  // Spends every code of the row if it still holds this live one: only one caller ever gets the row.
  redeemCode(
    id: string,
    codeHash: string,
    now: Date,
  ): Promise<AuthCodeRecord | null>;

  redeemToken(
    purpose: AuthCodePurpose,
    tokenHash: string,
    now: Date,
  ): Promise<AuthCodeRecord | null>;
}
