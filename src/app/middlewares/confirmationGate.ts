import { NextFunction, Request, Response } from "express";

import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../shared/errors";

// What "Confirm your email to continue" needs: the profile, the email change, and nothing of the account's data.
const ALLOWED: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/users\/[^/]+$/ },
  { method: "POST", path: /^\/users\/[^/]+\/email-change(\/resend)?$/ },
  { method: "DELETE", path: /^\/users\/[^/]+\/email-change$/ },
];

const allowed = (req: Request): boolean =>
  ALLOWED.some(
    (rule) => rule.method === req.method && rule.path.test(req.path),
  );

// Only a token past its deadline costs a read: whoever confirmed since then goes through.
export const confirmationGate =
  (users: Pick<IUserRepository, "getById">, now: () => number = Date.now) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const confirmBy = req.user?.confirmBy;
    if (confirmBy === undefined || now() < confirmBy || allowed(req)) {
      next();
      return;
    }
    const user = req.user ? await users.getById(req.user.userId) : null;
    if (user && !user.emailVerifiedAt) {
      throw new ApiError(
        "Forbidden",
        "Confirm your email to continue: nothing in the account changed",
        "EMAIL_CONFIRMATION_REQUIRED",
      );
    }
    next();
  };
