import { createHash, createHmac, randomBytes, randomInt } from "crypto";

import { ENVIRONMENT } from "../../shared/constants";

export const RESET_CODE_LIFETIME_MS = 30 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;

export const newCode = (): string =>
  randomInt(0, 1_000_000).toString().padStart(6, "0");

export const newLinkToken = (): string => randomBytes(32).toString("base64url");

// Keyed: six digits hashed without a secret fall to a million guesses against a copy of the database.
export const codeDigest = (toHash: string, code: string): string =>
  createHmac("sha256", ENVIRONMENT.JWT_SECRET)
    .update(`auth-code:${toHash}:${code}`)
    .digest("hex");

export const tokenDigest = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
