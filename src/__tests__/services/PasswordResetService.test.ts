jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    JWT_SECRET: "test-secret-key",
    BCRYPT_SALT_ROUNDS: 4,
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
}));

jest.mock("../../shared/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import bcryptjs from "bcryptjs";

import {
  codeDigest,
  emailChangeKey,
  tokenDigest,
} from "../../app/services/authCodes";
import { EmailOutcome } from "../../app/services/EmailService";
import { PasswordResetService } from "../../app/services/PasswordResetService";
import { User } from "../../domain/entities/User";
import {
  AuthCodeRecord,
  IAuthCodeRepository,
} from "../../domain/repositories/authCode/IAuthCodeRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { hashEmailAddress } from "../../shared/emailHash";
import { ApiError } from "../../shared/errors";
import logger from "../../shared/logger";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const EMAIL = "ana@example.com";
const TO_HASH = hashEmailAddress(EMAIL);
const REQUESTER = { ip: "203.0.113.7", recognizedDevice: null };

const ana = (overrides: Partial<User> = {}): User =>
  new User({
    id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
    name: "Ana",
    email: EMAIL,
    password: "old-hash",
    locale: "es",
    timezone: "America/Bogota",
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2025-06-01T00:00:00.000Z"),
    ...overrides,
  });

const record = (overrides: Partial<AuthCodeRecord> = {}): AuthCodeRecord => ({
  id: "code-row",
  purpose: "reset",
  toHash: TO_HASH,
  userId: ana().id,
  codes: [],
  attempts: 1,
  issuedAt: null,
  ...overrides,
});

interface Harness {
  service: PasswordResetService;
  users: Record<"getByEmail" | "getById" | "resetPassword", jest.Mock>;
  codes: jest.Mocked<IAuthCodeRepository>;
  email: {
    holdBrakes: jest.Mock;
    sendCode: jest.Mock;
    sendNotice: jest.Mock;
    providerCeilingMs: number;
  };
  accounts: { countByUserId: jest.Mock };
  transactions: { countByUserId: jest.Mock };
  sessions: { revokeAllForUser: jest.Mock };
  invitations: { touchUnansweredFor: jest.Mock };
  auth: { openSession: jest.Mock };
  wait: jest.Mock;
}

const build = (): Harness => {
  const users = {
    getByEmail: jest.fn().mockResolvedValue(null),
    getById: jest.fn().mockResolvedValue(null),
    resetPassword: jest.fn(
      async (
        id: string,
        password: string,
        question: { accounts: number; transactions: number } | null,
      ): Promise<User> =>
        ana({
          id,
          password,
          keepOrStartFresh: question && {
            askedAt: NOW,
            ...question,
            startFresh: null,
          },
        }),
    ),
  };
  const codes: jest.Mocked<IAuthCodeRepository> = {
    recordRequest: jest.fn().mockResolvedValue(undefined),
    issue: jest.fn().mockResolvedValue(undefined),
    countAttempt: jest.fn().mockResolvedValue(null),
    redeemCode: jest.fn().mockResolvedValue(null),
    redeemToken: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue(null),
    findByLiveToken: jest.fn().mockResolvedValue(null),
    discard: jest.fn().mockResolvedValue(undefined),
  };
  const email = {
    holdBrakes: jest.fn().mockResolvedValue({ limited: false }),
    sendCode: jest.fn().mockResolvedValue({
      status: "sent",
      provider: "mailpit",
      messageId: "m-1",
    } satisfies EmailOutcome),
    sendNotice: jest.fn().mockResolvedValue({
      status: "sent",
      provider: "mailpit",
      messageId: "m-2",
    } satisfies EmailOutcome),
    providerCeilingMs: 1500,
  };
  const accounts = { countByUserId: jest.fn().mockResolvedValue(0) };
  const transactions = { countByUserId: jest.fn().mockResolvedValue(0) };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
  const invitations = {
    touchUnansweredFor: jest.fn().mockResolvedValue(undefined),
  };
  const auth = {
    openSession: jest.fn().mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
      deviceToken: "device",
    }),
  };
  const wait = jest.fn().mockResolvedValue(undefined);
  const service = new PasswordResetService(
    users as unknown as IUserRepository,
    codes,
    email,
    accounts,
    transactions,
    sessions,
    invitations,
    auth,
    { resendAfterSeconds: 60, floorMarginMs: 500 },
    () => NOW,
    wait,
  );
  return {
    service,
    users,
    codes,
    email,
    accounts,
    transactions,
    sessions,
    invitations,
    auth,
    wait,
  };
};

describe("PasswordResetService.forgot", () => {
  beforeEach(() => jest.clearAllMocks());

  it("gives the same answer for an address with an account and one without", async () => {
    const withAccount = build();
    withAccount.users.getByEmail.mockResolvedValue(ana());
    const without = build();

    const a = await withAccount.service.forgot(EMAIL, REQUESTER);
    const b = await without.service.forgot("nobody@example.com", REQUESTER);

    expect(a).toEqual({ status: "accepted", resendAfterSeconds: 60 });
    expect(b).toEqual(a);
    expect(withAccount.codes.recordRequest).toHaveBeenCalledWith(
      "reset",
      TO_HASH,
      ana().id,
      new Date(NOW.getTime() + 30 * 60 * 1000),
    );
    expect(without.codes.recordRequest).toHaveBeenCalledWith(
      "reset",
      hashEmailAddress("nobody@example.com"),
      null,
      expect.any(Date),
    );
    expect(without.email.sendCode).not.toHaveBeenCalled();
  });

  it("counts the brakes before anything else, for every address", async () => {
    const { service, email, users } = build();
    email.holdBrakes.mockResolvedValue({
      limited: true,
      retryAfterSeconds: 42,
    });

    await expect(
      service.forgot("nobody@example.com", REQUESTER),
    ).resolves.toEqual({ status: "limited", retryAfterSeconds: 42 });
    expect(email.holdBrakes).toHaveBeenCalledWith({
      template: "password-reset",
      email: "nobody@example.com",
      requester: REQUESTER,
    });
    expect(users.getByEmail).not.toHaveBeenCalled();
  });

  it("sends the code in the account's language with the brakes already held", async () => {
    const { service, users, email, codes } = build();
    users.getByEmail.mockResolvedValue(ana());

    await service.forgot(EMAIL, REQUESTER);

    const [request] = email.sendCode.mock.calls[0];
    expect(request).toMatchObject({
      template: "password-reset",
      recipient: {
        userId: ana().id,
        email: EMAIL,
        locale: "es",
        timezone: "America/Bogota",
      },
      requester: REQUESTER,
      brakesHeld: true,
    });
    expect(request.data.code).toMatch(/^\d{6}$/);
    expect(request.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codes.issue).toHaveBeenCalledWith(
      "reset",
      TO_HASH,
      {
        codeHash: codeDigest(TO_HASH, request.data.code),
        tokenHash: tokenDigest(request.data.token),
        expiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
      },
      false,
      NOW,
    );
  });

  it("keeps the previous code alive when the email may or may not have gone", async () => {
    const { service, users, email, codes } = build();
    users.getByEmail.mockResolvedValue(ana());
    email.sendCode.mockResolvedValue({
      status: "failed",
      reason: "unconfirmed",
    });

    await service.forgot(EMAIL, REQUESTER);

    expect(codes.issue).toHaveBeenCalledWith(
      "reset",
      TO_HASH,
      expect.any(Object),
      true,
      NOW,
    );
  });

  it.each([
    ["rejected", { status: "failed", reason: "rejected" }],
    ["disabled", { status: "failed", reason: "disabled" }],
    ["unavailable", { status: "failed", reason: "unavailable" }],
    ["capped", { status: "limited", retryAfterSeconds: 3600 }],
  ] as const)(
    "leaves the old code in place and still answers the same when the send is %s",
    async (_label, outcome) => {
      const { service, users, email, codes } = build();
      users.getByEmail.mockResolvedValue(ana());
      email.sendCode.mockResolvedValue(outcome);

      await expect(service.forgot(EMAIL, REQUESTER)).resolves.toEqual({
        status: "accepted",
        resendAfterSeconds: 60,
      });
      expect(codes.issue).not.toHaveBeenCalled();
    },
  );

  it("never shows a failure past the brakes, and logs it", async () => {
    const { service, users, email } = build();
    users.getByEmail.mockResolvedValue(ana());
    email.sendCode.mockRejectedValue(new Error("database gone"));

    await expect(service.forgot(EMAIL, REQUESTER)).resolves.toEqual({
      status: "accepted",
      resendAfterSeconds: 60,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PASSWORD_RESET_NOT_SENT" }),
      expect.any(String),
    );
  });

  it("waits until the providers' ceiling plus a margin, so the time tells nothing", async () => {
    const { service, wait } = build();

    await service.forgot("nobody@example.com", REQUESTER);

    const [waited] = wait.mock.calls[0];
    expect(waited).toBeGreaterThan(1900);
    expect(waited).toBeLessThanOrEqual(2000);
  });
});

describe("PasswordResetService.reset", () => {
  beforeEach(() => jest.clearAllMocks());

  const withCode = { email: EMAIL, code: "482913" };

  it("changes the password, signs every other device out and answers a session", async () => {
    const { service, users, codes, sessions, auth } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana());

    const result = await service.reset(withCode, "new password 1", "Mozilla");

    expect(codes.countAttempt).toHaveBeenCalledWith("reset", TO_HASH, 5);
    expect(codes.redeemCode).toHaveBeenCalledWith(
      "code-row",
      codeDigest(TO_HASH, "482913"),
      NOW,
    );
    const [id, hash, question] = users.resetPassword.mock.calls[0];
    expect(id).toBe(ana().id);
    expect(await bcryptjs.compare("new password 1", hash)).toBe(true);
    expect(question).toBeNull();
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(ana().id);
    expect(auth.openSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: ana().id }),
      "Mozilla",
    );
    expect(result).toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
      deviceToken: "device",
      user: { id: ana().id, keepOrStartFresh: null },
    });
    expect(result.user).not.toHaveProperty("password");
  });

  it("tells the account its password changed, with the device that changed it [T-211]", async () => {
    const { service, users, codes, email } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana({ emailVerifiedAt: null }));

    await service.reset(withCode, "new password 1", "Mozilla");

    expect(email.sendNotice).toHaveBeenCalledTimes(1);
    expect(email.sendNotice).toHaveBeenCalledWith({
      template: "password-changed",
      data: { at: NOW, userAgent: "Mozilla" },
      recipient: {
        userId: ana().id,
        email: EMAIL,
        locale: "es",
        timezone: "America/Bogota",
      },
    });
  });

  it("keeps the new password when its notice cannot be sent, and logs it [T-211]", async () => {
    const { service, users, codes, email } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana());
    email.sendNotice.mockRejectedValue(new Error("render bug"));

    const result = await service.reset(withCode, "new password 1");

    expect(result.accessToken).toBe("access");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "SECURITY_NOTICE_NOT_SENT",
        template: "password-changed",
      }),
      expect.any(String),
    );
  });

  it("cancels the email change that was waiting, with its code and link [T-211]", async () => {
    const { service, users, codes } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    const waiting = {
      email: "thief@example.net",
      sentAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    };
    users.getById.mockResolvedValue(ana({ emailChange: waiting }));

    await service.reset(withCode, "new password 1");

    expect(codes.discard).toHaveBeenCalledWith(
      "email-change",
      emailChangeKey(ana().id, "thief@example.net"),
    );
  });

  it("discards nothing when no email change was waiting [T-211]", async () => {
    const { service, users, codes } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana());

    await service.reset(withCode, "new password 1");

    expect(codes.discard).not.toHaveBeenCalled();
  });

  it("asks keep or start fresh when the account never confirmed its email and holds something", async () => {
    const { service, users, codes, accounts, transactions } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana({ emailVerifiedAt: null }));
    accounts.countByUserId.mockResolvedValue(2);
    transactions.countByUserId.mockResolvedValue(31);

    const result = await service.reset(withCode, "new password 1");

    expect(users.resetPassword.mock.calls[0][2]).toEqual({
      accounts: 2,
      transactions: 31,
    });
    expect(result.user.keepOrStartFresh).toEqual({
      createdAt: new Date("2025-06-01T00:00:00.000Z"),
      accounts: 2,
      transactions: 31,
    });
  });

  it("does not ask when the never-confirmed account is empty", async () => {
    const { service, users, codes } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana({ emailVerifiedAt: null }));

    await service.reset(withCode, "new password 1");

    expect(users.resetPassword.mock.calls[0][2]).toBeNull();
  });

  it("does not count what a confirmed account holds", async () => {
    const { service, users, codes, accounts } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana());

    await service.reset(withCode, "new password 1");

    expect(accounts.countByUserId).not.toHaveBeenCalled();
  });

  it("lets the invitations that waited for a never-confirmed address reach the feed [T-209]", async () => {
    const { service, users, codes, invitations } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana({ emailVerifiedAt: null }));

    await service.reset(withCode, "new password 1");

    expect(invitations.touchUnansweredFor).toHaveBeenCalledWith(EMAIL, NOW);
  });

  it("touches no invitation when the address was already confirmed [T-209]", async () => {
    const { service, users, codes, invitations } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana());

    await service.reset(withCode, "new password 1");

    expect(invitations.touchUnansweredFor).not.toHaveBeenCalled();
  });

  const refusedWith = async (
    promise: Promise<unknown>,
    code: string,
  ): Promise<void> => {
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ statusCode: 400, code });
  };

  it("gives a wrong code the one answer, RESET_CODE_INVALID", async () => {
    const { service, codes, users } = build();
    codes.countAttempt.mockResolvedValue(record());

    await refusedWith(
      service.reset(withCode, "new password 1"),
      "RESET_CODE_INVALID",
    );
    expect(users.resetPassword).not.toHaveBeenCalled();
  });

  it("gives an address with no row, or with its tries spent, the same answer without trying", async () => {
    const { service, codes } = build();

    await refusedWith(
      service.reset(withCode, "new password 1"),
      "RESET_CODE_INVALID",
    );
    expect(codes.redeemCode).not.toHaveBeenCalled();
  });

  it("gives an address without an account the same answer", async () => {
    const { service, codes } = build();
    codes.countAttempt.mockResolvedValue(record({ userId: null }));

    await refusedWith(
      service.reset(withCode, "new password 1"),
      "RESET_CODE_INVALID",
    );
  });

  it("refuses a code for an address the account no longer has", async () => {
    const { service, codes, users } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana({ email: "moved@example.com" }));

    await refusedWith(
      service.reset(withCode, "new password 1"),
      "RESET_CODE_INVALID",
    );
    expect(users.resetPassword).not.toHaveBeenCalled();
  });

  it("refuses when the account was deleted between the code and the reset", async () => {
    const { service, codes } = build();
    codes.countAttempt.mockResolvedValue(record());
    codes.redeemCode.mockResolvedValue(record());

    await refusedWith(
      service.reset(withCode, "new password 1"),
      "RESET_CODE_INVALID",
    );
  });

  it("redeems the link's token with no address, and answers a dead one LINK_INVALID", async () => {
    const { service, codes, users } = build();
    const token = "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPzq7Xk2mVb9Rt";

    await refusedWith(
      service.reset({ token }, "new password 1"),
      "LINK_INVALID",
    );
    expect(codes.redeemToken).toHaveBeenCalledWith(
      "reset",
      tokenDigest(token),
      NOW,
    );
    expect(codes.countAttempt).not.toHaveBeenCalled();

    codes.redeemToken.mockResolvedValue(record());
    users.getById.mockResolvedValue(ana());
    await expect(
      service.reset({ token }, "new password 1"),
    ).resolves.toMatchObject({
      accessToken: "access",
    });
  });
});
