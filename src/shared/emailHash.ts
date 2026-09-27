import { createHash } from "crypto";

export const hashEmailAddress = (email: string): string =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
