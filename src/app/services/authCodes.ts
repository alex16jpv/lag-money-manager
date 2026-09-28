import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "crypto";

import {
  ENVIRONMENT,
  NOT_ME_TOKEN_FORMAT,
  UNDO_TOKEN_FORMAT,
} from "../../shared/constants";
import { hashEmailAddress } from "../../shared/emailHash";

export const RESET_CODE_LIFETIME_MS = 30 * 60 * 1000;
export const VERIFY_CODE_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const UNDO_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
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

export const tokenDigest = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export interface NotMeClaim {
  userId: string;
  issuedAt: Date;
  nonce: Buffer;
  mac: Buffer;
}

const notMeMac = (
  userId: string,
  toHash: string,
  issued: Buffer,
  nonce: Buffer,
): Buffer =>
  createHmac("sha256", ENVIRONMENT.JWT_SECRET)
    .update(
      `not-me:${userId}:${toHash}:${issued.toString("hex")}:${nonce.toString("hex")}`,
    )
    .digest();

const uuidBytes = (id: string): Buffer =>
  Buffer.from(id.replace(/-/g, ""), "hex");

const uuidOf = (bytes: Buffer): string => {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const signNotMeToken = (
  userId: string,
  toHash: string,
  now: Date,
): string => {
  const issued = Buffer.alloc(8);
  issued.writeBigUInt64BE(BigInt(now.getTime()));
  const nonce = randomBytes(16);
  return Buffer.concat([
    uuidBytes(userId),
    issued,
    nonce,
    notMeMac(userId, toHash, issued, nonce),
  ]).toString("base64url");
};

export const readNotMeToken = (token: string): NotMeClaim | null => {
  if (!NOT_ME_TOKEN_FORMAT.test(token)) return null;
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== 72 || bytes.toString("base64url") !== token) {
    return null;
  }
  return {
    userId: uuidOf(bytes.subarray(0, 16)),
    issuedAt: new Date(Number(bytes.readBigUInt64BE(16))),
    nonce: bytes.subarray(24, 40),
    mac: bytes.subarray(40),
  };
};

// False for another address, and for one issued before the account last changed its address.
export const notMeTokenFits = (
  claim: NotMeClaim,
  toHash: string,
  emailChangedAt: Date | null,
): boolean => {
  const issued = Buffer.alloc(8);
  issued.writeBigUInt64BE(BigInt(claim.issuedAt.getTime()));
  const signed = timingSafeEqual(
    claim.mac,
    notMeMac(claim.userId, toHash, issued, claim.nonce),
  );
  return signed && (!emailChangedAt || claim.issuedAt >= emailChangedAt);
};

// The account's id locates the link; the 32 random bytes are what proves it, and only their hash is kept.
export const newUndoToken = (userId: string): string =>
  Buffer.concat([uuidBytes(userId), randomBytes(32)]).toString("base64url");

export const undoTokenAccount = (token: string): string | null => {
  if (!UNDO_TOKEN_FORMAT.test(token)) return null;
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== 48 || bytes.toString("base64url") !== token) {
    return null;
  }
  return uuidOf(bytes.subarray(0, 16));
};
