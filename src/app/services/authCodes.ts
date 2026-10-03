import { createHash, createHmac, randomBytes, randomInt } from "crypto";

import { ACCOUNT_LINK_TOKEN_FORMAT, ENVIRONMENT } from "../../shared/constants";
import { hashEmailAddress } from "../../shared/emailHash";

export const RESET_CODE_LIFETIME_MS = 30 * 60 * 1000;
export const VERIFY_CODE_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const UNDO_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const RESTORE_LINK_LIFETIME_MS = UNDO_LINK_LIFETIME_MS;
export const CODE_MAX_ATTEMPTS = 5;

export const newCode = (): string =>
  randomInt(0, 1_000_000).toString().padStart(6, "0");

export const newLinkToken = (): string => randomBytes(32).toString("base64url");

// Keyed: six digits hashed without a secret fall to a million guesses against a copy of the database.
export const codeDigest = (toHash: string, code: string): string =>
  createHmac("sha256", ENVIRONMENT.JWT_SECRET)
    .update(`auth-code:${toHash}:${code}`)
    .digest("hex");

// Many accounts can ask for the same new address, so its row belongs to one account and that address.
export const emailChangeKey = (userId: string, email: string): string =>
  createHash("sha256")
    .update(`email-change:${userId}:${hashEmailAddress(email)}`)
    .digest("hex");

// Each sign-up has its own row: a newer one for the address must never inherit a live code or link of the one it replaced.
export const signUpCodeKey = (signUpId: string): string =>
  createHash("sha256").update(`sign-up:${signUpId}`).digest("hex");

export const tokenDigest = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const uuidBytes = (id: string): Buffer =>
  Buffer.from(id.replace(/-/g, ""), "hex");

const uuidOf = (bytes: Buffer): string => {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// The account's id locates the link; the 32 random bytes are what proves it, and only their hash is kept.
export const newAccountLinkToken = (userId: string): string =>
  Buffer.concat([uuidBytes(userId), randomBytes(32)]).toString("base64url");

export const accountLinkOwner = (token: string): string | null => {
  if (!ACCOUNT_LINK_TOKEN_FORMAT.test(token)) return null;
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== 48 || bytes.toString("base64url") !== token) {
    return null;
  }
  return uuidOf(bytes.subarray(0, 16));
};
