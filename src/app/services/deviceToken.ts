import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";

import { ENVIRONMENT } from "../../shared/constants";

const DEVICE_AUDIENCE = "device";
const DEVICE_TOKEN_LIFETIME = "365d";

export interface DeviceClaim {
  deviceId: string;
  tokenVersion: number;
  issuedAt: Date;
}

const secret = (): string =>
  ENVIRONMENT.REFRESH_SECRET ?? ENVIRONMENT.JWT_SECRET;

const emailDigest = (email: string): string =>
  createHash("sha256").update(email).digest("base64url");

export const signDeviceToken = (email: string, tokenVersion: number): string =>
  jwt.sign({ tokenVersion, jti: uuidv7(), issuedAtMs: Date.now() }, secret(), {
    algorithm: "HS256",
    audience: DEVICE_AUDIENCE,
    subject: emailDigest(email),
    expiresIn: DEVICE_TOKEN_LIFETIME,
  });

export const readDeviceToken = (
  token: unknown,
  email: string,
): DeviceClaim | null => {
  if (typeof token !== "string" || token.length === 0) return null;
  let payload: unknown;
  try {
    payload = jwt.verify(token, secret(), {
      algorithms: ["HS256"],
      audience: DEVICE_AUDIENCE,
      subject: emailDigest(email),
    });
  } catch {
    // A forged, expired or foreign token only means an unrecognized device: the stricter budgets apply.
    return null;
  }
  const { jti, tokenVersion, iat, issuedAtMs } = payload as {
    jti?: unknown;
    tokenVersion?: unknown;
    iat?: unknown;
    issuedAtMs?: unknown;
  };
  if (
    typeof jti !== "string" ||
    jti.length === 0 ||
    typeof tokenVersion !== "number" ||
    typeof iat !== "number"
  ) {
    return null;
  }
  // Tokens from before T-211 carry only iat, to the second.
  const issuedAt = new Date(
    typeof issuedAtMs === "number" ? issuedAtMs : iat * 1000,
  );
  return { deviceId: jti, tokenVersion, issuedAt };
};
