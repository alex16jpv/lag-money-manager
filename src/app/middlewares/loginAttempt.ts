import { Request } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- module augmentation of Express types requires a namespace
  namespace Express {
    interface Request {
      recognizedDevice?: string;
    }
  }
}

// Runs before Zod: normalize the same way the schema will.
export const attemptedEmail = (req: Request): string | null => {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email ? email.trim().toLowerCase() : null;
};
