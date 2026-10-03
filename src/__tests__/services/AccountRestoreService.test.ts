jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    JWT_SECRET: "test-secret-key",
    BCRYPT_SALT_ROUNDS: 4,
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  ACCOUNT_LINK_TOKEN_FORMAT: /^[A-Za-z0-9_-]{64}$/,
}));

jest.mock("../../shared/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import bcryptjs from "bcryptjs";

import { AccountRestoreService } from "../../app/services/AccountRestoreService";
import {
  emailChangeKey,
  newAccountLinkToken,
  tokenDigest,
} from "../../app/services/authCodes";
import { User } from "../../domain/entities/User";
import { hashEmailAddress } from "../../shared/emailHash";
import logger from "../../shared/logger";
import { mockUserRepo } from "./userRepoMock";

const NOW = new Date("2026-09-28T15:00:00.000Z");
const USER_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const TOKEN = newAccountLinkToken(USER_ID);

const ana = (overrides: Partial<User> = {}): User =>
  new User({
    id: USER_ID,
    name: "Ana",
    email: "ana@example.com",
    emailVerifiedAt: new Date("2026-01-01"),
    deletedAt: new Date("2026-09-27T10:00:00Z"),
    keptUntil: new Date("2026-10-28T05:00:00Z"),
    restoreLinks: [
      {
        tokenHash: tokenDigest(TOKEN),
        expiresAt: new Date("2026-10-04T10:00:00Z"),
      },
    ],
    ...overrides,
  });

interface Harness {
  service: AccountRestoreService;
  users: ReturnType<typeof mockUserRepo>;
  codes: Record<"recordRequest" | "issue" | "discard", jest.Mock>;
  email: { sendCode: jest.Mock };
  sessions: { revokeAllForUser: jest.Mock };
}

const build = (): Harness => {
  const users = mockUserRepo();
  users.getForUndo.mockResolvedValue(ana());
  users.restoreFromLink.mockResolvedValue(
    ana({ deletedAt: null, keptUntil: null }),
  );
  const codes = {
    recordRequest: jest.fn().mockResolvedValue(undefined),
    issue: jest.fn().mockResolvedValue(undefined),
    discard: jest.fn().mockResolvedValue(undefined),
  };
  const email = {
    sendCode: jest.fn().mockResolvedValue({
      status: "sent",
      provider: "mailpit",
      messageId: "m",
    }),
  };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
  const service = new AccountRestoreService(
    users,
    codes,
    email,
    sessions,
    () => NOW,
  );
  return { service, users, codes, email, sessions };
};

describe("AccountRestoreService [T-238]", () => {
  beforeEach(() => jest.clearAllMocks());

  it("brings the account back with no usable password, signs everyone out and mails a code in its restore words", async () => {
    const { service, users, sessions, email, codes } = build();

    await expect(service.restore(TOKEN)).resolves.toEqual({
      email: "ana@example.com",
      codeSent: true,
    });

    const [id, tokenHash, unusable, when] = users.restoreFromLink.mock.calls[0];
    expect([id, tokenHash, when]).toEqual([USER_ID, tokenDigest(TOKEN), NOW]);
    expect(await bcryptjs.compare("anything", unusable)).toBe(false);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
    expect(codes.recordRequest).toHaveBeenCalledWith(
      "reset",
      hashEmailAddress("ana@example.com"),
      USER_ID,
      new Date(NOW.getTime() + 30 * 60 * 1000),
    );
    expect(email.sendCode).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "password-reset-after-undo",
        data: expect.objectContaining({ restored: true }),
        requester: null,
      }),
    );
  });

  it("works on an account already restored, as long as its link does", async () => {
    const { service, users } = build();
    users.getForUndo.mockResolvedValue(
      ana({ deletedAt: null, keptUntil: null }),
    );

    await expect(service.restore(TOKEN)).resolves.toMatchObject({
      codeSent: true,
    });
  });

  it("cancels a change of email that waited, with its code and link", async () => {
    const { service, users, codes } = build();
    users.getForUndo.mockResolvedValue(
      ana({
        emailChange: {
          email: "thief@example.net",
          sentAt: NOW,
          expiresAt: new Date(NOW.getTime() + 60_000),
        },
      }),
    );

    await service.restore(TOKEN);

    expect(codes.discard).toHaveBeenCalledWith(
      "email-change",
      emailChangeKey(USER_ID, "thief@example.net"),
    );
  });

  it.each([
    ["a token of no account", "x".repeat(64), () => null],
    ["another link's token", newAccountLinkToken(USER_ID), () => ana()],
    [
      "a link past its 7 days",
      TOKEN,
      () =>
        ana({
          restoreLinks: [{ tokenHash: tokenDigest(TOKEN), expiresAt: NOW }],
        }),
    ],
  ])(
    "says LINK_INVALID for %s, and restores nothing",
    async (_l, token, found) => {
      const { service, users } = build();
      users.getForUndo.mockResolvedValue(found());

      await expect(service.restore(token)).rejects.toMatchObject({
        statusCode: 400,
        code: "LINK_INVALID",
      });
      expect(users.restoreFromLink).not.toHaveBeenCalled();
    },
  );

  it("says LINK_INVALID when the link was spent between the read and the write", async () => {
    const { service, users, sessions } = build();
    users.restoreFromLink.mockResolvedValue(null);

    await expect(service.restore(TOKEN)).rejects.toMatchObject({
      code: "LINK_INVALID",
    });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("answers codeSent false and logs it when the code cannot go, and the restore stands", async () => {
    const { service, email } = build();
    email.sendCode.mockRejectedValue(new Error("render bug"));

    await expect(service.restore(TOKEN)).resolves.toEqual({
      email: "ana@example.com",
      codeSent: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "UNDO_RESET_CODE_NOT_SENT" }),
      expect.any(String),
    );
  });
});
