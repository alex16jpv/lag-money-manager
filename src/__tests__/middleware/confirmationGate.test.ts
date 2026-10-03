import { NextFunction, Request, Response } from "express";

import { confirmationGate } from "../../app/middlewares/confirmationGate";
import { User } from "../../domain/entities/User";
import { ApiError } from "../../shared/errors";

const NOW = 1_000_000;
const USER_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";

const unconfirmed = new User({ id: USER_ID, name: "Old", email: "o@x.co" });
const confirmed = new User({ ...unconfirmed, emailVerifiedAt: new Date() });

const run = async (
  req: Partial<Request>,
  found: User | null = unconfirmed,
  deadlinesOn = true,
): Promise<{ next: jest.Mock; getById: jest.Mock; error?: unknown }> => {
  const getById = jest.fn().mockResolvedValue(found);
  const next = jest.fn();
  try {
    await confirmationGate({ getById }, deadlinesOn, () => NOW)(
      req as Request,
      {} as Response,
      next as unknown as NextFunction,
    );
    return { next, getById };
  } catch (error) {
    return { next, getById, error };
  }
};

const past = { userId: USER_ID, email: "o@x.co", confirmBy: NOW - 1 };

describe("confirmationGate [T-238]", () => {
  it("lets a token with no deadline, or one still ahead, through without reading anything", async () => {
    for (const user of [
      { userId: USER_ID, email: "o@x.co" },
      { ...past, confirmBy: NOW + 1 },
    ]) {
      const { next, getById } = await run({
        user,
        method: "GET",
        path: "/accounts",
      });
      expect(next).toHaveBeenCalledWith();
      expect(getById).not.toHaveBeenCalled();
    }
  });

  it("answers 403 EMAIL_CONFIRMATION_REQUIRED past the deadline while the account is unconfirmed", async () => {
    const { next, error } = await run({
      user: past,
      method: "POST",
      path: "/sync",
    });

    expect(next).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      statusCode: 403,
      code: "EMAIL_CONFIRMATION_REQUIRED",
    });
  });

  it("lets everything through once the deadlines are switched off", async () => {
    const { next, getById, error } = await run(
      { user: past, method: "GET", path: "/accounts" },
      unconfirmed,
      false,
    );

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(getById).not.toHaveBeenCalled();
  });

  it("lets an account confirmed since its token was signed through", async () => {
    const { next, error } = await run(
      { user: past, method: "GET", path: "/accounts" },
      confirmed,
    );

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ["GET", `/users/${USER_ID}`],
    ["POST", `/users/${USER_ID}/email-change`],
    ["POST", `/users/${USER_ID}/email-change/resend`],
    ["DELETE", `/users/${USER_ID}/email-change`],
  ])(
    "lets %s %s through: the profile and the change of email",
    async (method, path) => {
      const { next, getById } = await run({ user: past, method, path });
      expect(next).toHaveBeenCalledWith();
      expect(getById).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["PUT", `/users/${USER_ID}`],
    ["DELETE", `/users/${USER_ID}`],
    ["GET", `/users/${USER_ID}/email-change/other`],
  ])("keeps %s %s behind the confirmation", async (method, path) => {
    const { error } = await run({ user: past, method, path });
    expect(error).toMatchObject({ code: "EMAIL_CONFIRMATION_REQUIRED" });
  });
});
