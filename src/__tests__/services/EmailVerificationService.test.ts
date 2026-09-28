jest.mock("../../shared/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import {
  codeDigest,
  readNotMeToken,
  signNotMeToken,
  tokenDigest,
} from "../../app/services/authCodes";
import { EmailOutcome } from "../../app/services/EmailService";
import { EmailVerificationService } from "../../app/services/EmailVerificationService";
import { User } from "../../domain/entities/User";
import {
  AuthCodeRecord,
  IAuthCodeRepository,
} from "../../domain/repositories/authCode/IAuthCodeRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { hashEmailAddress } from "../../shared/emailHash";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const USER_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const EMAIL = "ana@example.com";
const TO_HASH = hashEmailAddress(EMAIL);
const REQUESTER = { ip: "203.0.113.7", recognizedDevice: null };

const ana = (overrides: Partial<User> = {}): User =>
  new User({
    id: USER_ID,
    name: "Ana",
    email: EMAIL,
    locale: "es",
    timezone: "America/Bogota",
    ...overrides,
  });

const record = (overrides: Partial<AuthCodeRecord> = {}): AuthCodeRecord => ({
  id: "code-row",
  purpose: "verify",
  toHash: TO_HASH,
  userId: USER_ID,
  codes: [
    {
      codeHash: codeDigest(TO_HASH, "123456"),
      tokenHash: tokenDigest("link-token-of-the-email"),
      expiresAt: new Date(NOW.getTime() + DAY_MS),
    },
  ],
  attempts: 1,
  issuedAt: new Date(NOW.getTime() - 20_000),
  ...overrides,
});

const sent: EmailOutcome = {
  status: "sent",
  provider: "mailpit",
  messageId: "m-1",
};

interface Harness {
  service: EmailVerificationService;
  users: Record<
    | "getById"
    | "markEmailVerified"
    | "getForErasure"
    | "claimErasure"
    | "eraseForGood",
    jest.Mock
  >;
  codes: jest.Mocked<IAuthCodeRepository>;
  email: { sendCode: jest.Mock };
  invitations: Record<
    "touchUnansweredFor" | "withdrawAll" | "leaveAll",
    jest.Mock
  >;
  sessions: { revokeAllForUser: jest.Mock };
  eraser: { eraseAccount: jest.Mock };
}

const build = (): Harness => {
  const users = {
    getById: jest.fn().mockResolvedValue(ana()),
    markEmailVerified: jest.fn(async () =>
      ana({ emailVerifiedAt: NOW, updatedAt: NOW }),
    ),
    getForErasure: jest.fn().mockResolvedValue(ana()),
    claimErasure: jest.fn(async () => ana({ deletedAt: NOW } as never)),
    eraseForGood: jest.fn().mockResolvedValue(undefined),
  };
  const codes: jest.Mocked<IAuthCodeRepository> = {
    recordRequest: jest.fn().mockResolvedValue(undefined),
    issue: jest.fn().mockResolvedValue(undefined),
    countAttempt: jest.fn().mockResolvedValue(record()),
    redeemCode: jest.fn(),
    redeemToken: jest.fn(),
    find: jest.fn().mockResolvedValue(null),
    findByLiveToken: jest.fn().mockResolvedValue(record()),
    discard: jest.fn().mockResolvedValue(undefined),
  };
  const email = { sendCode: jest.fn().mockResolvedValue(sent) };
  const invitations = {
    touchUnansweredFor: jest.fn().mockResolvedValue(undefined),
    withdrawAll: jest.fn().mockResolvedValue(0),
    leaveAll: jest.fn().mockResolvedValue(0),
  };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
  const eraser = { eraseAccount: jest.fn().mockResolvedValue(undefined) };
  const service = new EmailVerificationService(
    users as unknown as IUserRepository,
    codes,
    email,
    invitations,
    sessions,
    eraser,
    { resendAfterSeconds: 60 },
    () => NOW,
  );
  return { service, users, codes, email, invitations, sessions, eraser };
};

describe("EmailVerificationService", () => {
  describe("send", () => {
    it("emails a code, a link and an It wasn't me, and keeps only their hashes, for 24 hours", async () => {
      const { service, email, codes } = build();

      await expect(service.send(ana(), REQUESTER)).resolves.toEqual(sent);

      const request = email.sendCode.mock.calls[0][0];
      expect(request).toMatchObject({
        template: "verify-email",
        recipient: {
          userId: USER_ID,
          email: EMAIL,
          locale: "es",
          timezone: "America/Bogota",
        },
        requester: REQUESTER,
      });
      const { code, token, notMeToken } = request.data;
      expect(code).toMatch(/^\d{6}$/);
      expect(readNotMeToken(notMeToken)?.userId).toBe(USER_ID);

      const expiresAt = new Date(NOW.getTime() + DAY_MS);
      expect(codes.recordRequest).toHaveBeenCalledWith(
        "verify",
        TO_HASH,
        USER_ID,
        expiresAt,
      );
      expect(codes.issue).toHaveBeenCalledWith(
        "verify",
        TO_HASH,
        {
          codeHash: codeDigest(TO_HASH, code),
          tokenHash: tokenDigest(token),
          expiresAt,
        },
        false,
        NOW,
      );
    });

    it("offers no It wasn't me to an account that was confirmed once", async () => {
      const { service, email } = build();

      await service.send(ana({ firstVerifiedAt: NOW }), REQUESTER);

      expect(email.sendCode.mock.calls[0][0].data).not.toHaveProperty(
        "notMeToken",
      );
    });

    it("keeps the live code next to the new one when the email may still arrive", async () => {
      const { service, email, codes } = build();
      email.sendCode.mockResolvedValue({
        status: "failed",
        reason: "unconfirmed",
      });

      await service.send(ana(), REQUESTER);

      expect(codes.issue.mock.calls[0][3]).toBe(true);
    });

    it.each([
      ["limited", { status: "limited", retryAfterSeconds: 40 }],
      ["switched off", { status: "failed", reason: "disabled" }],
      ["refused", { status: "failed", reason: "rejected" }],
      ["not taken", { status: "failed", reason: "unavailable" }],
    ] as const)(
      "leaves the codes as they were when the email was %s",
      async (_label, outcome) => {
        const { service, email, codes } = build();
        email.sendCode.mockResolvedValue(outcome);

        await expect(service.send(ana(), REQUESTER)).resolves.toEqual(outcome);

        expect(codes.recordRequest).not.toHaveBeenCalled();
        expect(codes.issue).not.toHaveBeenCalled();
      },
    );
  });

  describe("resend", () => {
    it("sends to the account's own address", async () => {
      const { service, email } = build();

      await service.resend(USER_ID, REQUESTER);

      expect(email.sendCode.mock.calls[0][0].recipient.email).toBe(EMAIL);
    });

    it("refuses an email already confirmed, and sends nothing", async () => {
      const { service, users, email } = build();
      users.getById.mockResolvedValue(ana({ emailVerifiedAt: NOW }));

      await expect(service.resend(USER_ID, REQUESTER)).rejects.toMatchObject({
        statusCode: 409,
        code: "EMAIL_ALREADY_VERIFIED",
      });
      expect(email.sendCode).not.toHaveBeenCalled();
    });

    it("answers an account that is gone with 404", async () => {
      const { service, users } = build();
      users.getById.mockResolvedValue(null);

      await expect(service.resend(USER_ID, REQUESTER)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe("status", () => {
    it("is null once the email is confirmed, and reads nothing", async () => {
      const { service, codes } = build();

      await expect(
        service.status(ana({ emailVerifiedAt: NOW })),
      ).resolves.toBeNull();
      expect(codes.find).not.toHaveBeenCalled();
    });

    it("says no code was ever sent to an account from before email", async () => {
      const { service, codes } = build();

      await expect(service.status(ana())).resolves.toEqual({
        codeLive: false,
        lastSentAt: null,
        resendAvailableAt: null,
      });
      expect(codes.find).toHaveBeenCalledWith("verify", TO_HASH);
    });

    it("shows a live code and when Resend can go", async () => {
      const { service, codes } = build();
      codes.find.mockResolvedValue(record());

      await expect(service.status(ana())).resolves.toEqual({
        codeLive: true,
        lastSentAt: new Date(NOW.getTime() - 20_000),
        resendAvailableAt: new Date(NOW.getTime() + 40_000),
      });
    });

    it.each([
      ["used up by five tries", record({ attempts: 5 })],
      [
        "expired",
        record({
          codes: [
            {
              codeHash: "x",
              tokenHash: "y",
              expiresAt: new Date(NOW.getTime() - 1),
            },
          ],
        }),
      ],
    ])("reads a code %s as not live", async (_label, row) => {
      const { service, codes } = build();
      codes.find.mockResolvedValue(row);

      await expect(service.status(ana())).resolves.toMatchObject({
        codeLive: false,
      });
    });

    it("ignores what was sent to this address for another account", async () => {
      const { service, codes } = build();
      codes.find.mockResolvedValue(record({ userId: "someone-else" }));

      await expect(service.status(ana())).resolves.toEqual({
        codeLive: false,
        lastSentAt: null,
        resendAvailableAt: null,
      });
    });

    it("lets Resend go at once when the interval has passed", async () => {
      const { service, codes } = build();
      codes.find.mockResolvedValue(
        record({ issuedAt: new Date(NOW.getTime() - 60_000) }),
      );

      await expect(service.status(ana())).resolves.toMatchObject({
        resendAvailableAt: null,
      });
    });
  });

  describe("verifyCode", () => {
    it("confirms the address with the code it was sent, and lets its invitations reach the feed", async () => {
      const { service, codes, users, invitations } = build();

      await service.verifyCode(USER_ID, "123456");

      expect(codes.countAttempt).toHaveBeenCalledWith("verify", TO_HASH, 5);
      expect(users.markEmailVerified).toHaveBeenCalledWith(USER_ID, EMAIL, NOW);
      expect(invitations.touchUnansweredFor).toHaveBeenCalledWith(EMAIL, NOW);
    });

    it("does not spend the code: the link keeps working after it", async () => {
      const { service, codes } = build();

      await service.verifyCode(USER_ID, "123456");

      expect(codes.redeemCode).not.toHaveBeenCalled();
      expect(codes.redeemToken).not.toHaveBeenCalled();
    });

    it("answers an email already confirmed with success, without counting a try", async () => {
      const { service, codes, users } = build();
      users.getById.mockResolvedValue(ana({ emailVerifiedAt: NOW }));

      await expect(service.verifyCode(USER_ID, "000000")).resolves.toBe(
        undefined,
      );
      expect(codes.countAttempt).not.toHaveBeenCalled();
    });

    it("tells a wrong code from one that stopped working: the account is the caller's own", async () => {
      const { service, codes, users } = build();

      await expect(service.verifyCode(USER_ID, "654321")).rejects.toMatchObject(
        { statusCode: 400, code: "EMAIL_CODE_INVALID" },
      );

      codes.countAttempt.mockResolvedValue(null);
      await expect(service.verifyCode(USER_ID, "123456")).rejects.toMatchObject(
        { code: "EMAIL_CODE_EXPIRED" },
      );

      codes.countAttempt.mockResolvedValue(
        record({
          codes: [
            {
              codeHash: codeDigest(TO_HASH, "123456"),
              tokenHash: "t",
              expiresAt: new Date(NOW.getTime() - 1),
            },
          ],
        }),
      );
      await expect(service.verifyCode(USER_ID, "123456")).rejects.toMatchObject(
        { code: "EMAIL_CODE_EXPIRED" },
      );
      expect(users.markEmailVerified).not.toHaveBeenCalled();
    });

    it("does not take a code sent to this address for another account", async () => {
      const { service, codes, users } = build();
      codes.countAttempt.mockResolvedValue(record({ userId: "someone-else" }));

      await expect(service.verifyCode(USER_ID, "123456")).rejects.toMatchObject(
        { code: "EMAIL_CODE_EXPIRED" },
      );
      expect(users.markEmailVerified).not.toHaveBeenCalled();
    });

    it("does not take a code sent to the address the account had before", async () => {
      const { service, users } = build();
      users.getById.mockResolvedValue(ana({ email: "new@example.com" }));

      await expect(service.verifyCode(USER_ID, "123456")).rejects.toMatchObject(
        { code: "EMAIL_CODE_INVALID" },
      );
    });

    it("refuses when the account moved to another address between the check and the write", async () => {
      const { service, users, invitations } = build();
      users.markEmailVerified.mockResolvedValue(null as never);

      await expect(service.verifyCode(USER_ID, "123456")).rejects.toMatchObject(
        { code: "EMAIL_CODE_INVALID" },
      );
      expect(invitations.touchUnansweredFor).not.toHaveBeenCalled();
    });

    it("answers an account that is gone with 404", async () => {
      const { service, users } = build();
      users.getById.mockResolvedValue(null);

      await expect(service.verifyCode(USER_ID, "123456")).rejects.toMatchObject(
        { statusCode: 404 },
      );
    });
  });

  describe("verifyLink", () => {
    it("confirms the account the link names, without a session", async () => {
      const { service, codes, users } = build();

      await service.verifyLink("link-token-of-the-email");

      expect(codes.findByLiveToken).toHaveBeenCalledWith(
        "verify",
        tokenDigest("link-token-of-the-email"),
        NOW,
      );
      expect(users.markEmailVerified).toHaveBeenCalledWith(USER_ID, EMAIL, NOW);
    });

    it("answers a link of an account already confirmed with success", async () => {
      const { service, users } = build();
      users.getById.mockResolvedValue(ana({ emailVerifiedAt: NOW }));

      await expect(service.verifyLink("link-token-of-the-email")).resolves.toBe(
        undefined,
      );
      expect(users.markEmailVerified).not.toHaveBeenCalled();
    });

    it.each([
      ["expired, replaced or unknown", () => null],
      ["for no account", () => record({ userId: null })],
    ])("refuses a link %s", async (_label, row) => {
      const { service, codes } = build();
      codes.findByLiveToken.mockResolvedValue(row());

      await expect(service.verifyLink("t".repeat(43))).rejects.toMatchObject({
        statusCode: 400,
        code: "LINK_INVALID",
      });
    });

    it("refuses a link for the address the account no longer has", async () => {
      const { service, users } = build();
      users.getById.mockResolvedValue(ana({ email: "new@example.com" }));

      await expect(
        service.verifyLink("link-token-of-the-email"),
      ).rejects.toMatchObject({ code: "LINK_INVALID" });
      expect(users.markEmailVerified).not.toHaveBeenCalled();
    });
  });

  describe("notMe", () => {
    const token = (): string => signNotMeToken(USER_ID, TO_HASH, NOW);

    it("erases the account and what it left, invitations ended first, then frees the address", async () => {
      const { service, users, sessions, invitations, eraser } = build();
      const order: string[] = [];
      users.claimErasure.mockImplementation(async () => {
        order.push("claim");
        return ana();
      });
      sessions.revokeAllForUser.mockImplementation(async () => {
        order.push("sessions");
      });
      invitations.withdrawAll.mockImplementation(async () => {
        order.push("withdraw");
        return 0;
      });
      invitations.leaveAll.mockImplementation(async () => {
        order.push("leave");
        return 0;
      });
      eraser.eraseAccount.mockImplementation(async () => {
        order.push("erase");
      });
      users.eraseForGood.mockImplementation(async () => {
        order.push("account");
      });

      await service.notMe(token());

      expect(users.claimErasure).toHaveBeenCalledWith(USER_ID, EMAIL, NOW, NOW);
      expect(invitations.withdrawAll).toHaveBeenCalledWith(
        { userId: USER_ID, statuses: ["PENDING", "ACCEPTED"] },
        NOW,
      );
      expect(eraser.eraseAccount).toHaveBeenCalledWith(USER_ID, TO_HASH);
      expect(order).toEqual([
        "claim",
        "sessions",
        "withdraw",
        "leave",
        "erase",
        "account",
      ]);
    });

    it("refuses a token for the address the account no longer has", async () => {
      const { service, users, eraser } = build();
      users.getForErasure.mockResolvedValue(ana({ email: "new@example.com" }));

      await expect(service.notMe(token())).rejects.toMatchObject({
        code: "LINK_INVALID",
      });
      expect(users.claimErasure).not.toHaveBeenCalled();
      expect(eraser.eraseAccount).not.toHaveBeenCalled();
    });

    it("refuses once the account is confirmed, or gone", async () => {
      const { service, users, eraser } = build();
      users.getForErasure.mockResolvedValue(null);

      await expect(service.notMe(token())).rejects.toMatchObject({
        code: "LINK_INVALID",
      });
      expect(eraser.eraseAccount).not.toHaveBeenCalled();
    });

    it("erases nothing when the account was confirmed between the read and the claim", async () => {
      const { service, users, sessions, eraser } = build();
      users.claimErasure.mockResolvedValue(null as never);

      await expect(service.notMe(token())).rejects.toMatchObject({
        code: "LINK_INVALID",
      });
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      expect(eraser.eraseAccount).not.toHaveBeenCalled();
      expect(users.eraseForGood).not.toHaveBeenCalled();
    });

    it("refuses a forged or malformed token before reading anything", async () => {
      const { service, users } = build();
      const bytes = Buffer.from(token(), "base64url");
      bytes[63] ^= 1;

      await expect(
        service.notMe(bytes.toString("base64url")),
      ).rejects.toMatchObject({ code: "LINK_INVALID" });
      await expect(service.notMe("not-a-token")).rejects.toMatchObject({
        code: "LINK_INVALID",
      });
      expect(users.claimErasure).not.toHaveBeenCalled();
      expect(users.getForErasure).toHaveBeenCalledTimes(1);
    });

    it("reads what the token carries, and nothing of another length", () => {
      expect(readNotMeToken(token())).toMatchObject({
        userId: USER_ID,
        issuedAt: NOW,
      });
      expect(readNotMeToken(token().slice(1))).toBeNull();
    });

    it("refuses a token issued before the account last changed its address, and takes a later one", async () => {
      const { service, users, eraser } = build();
      const before = token();
      users.getForErasure.mockResolvedValue(
        ana({ emailChangedAt: new Date(NOW.getTime() + 1) }),
      );

      await expect(service.notMe(before)).rejects.toMatchObject({
        code: "LINK_INVALID",
      });
      expect(users.claimErasure).not.toHaveBeenCalled();

      const after = signNotMeToken(
        USER_ID,
        TO_HASH,
        new Date(NOW.getTime() + 5),
      );
      await service.notMe(after);
      expect(eraser.eraseAccount).toHaveBeenCalledTimes(1);
    });

    it("gives every email its own link, and all of them work", async () => {
      const first = token();
      const second = token();
      expect(first).not.toBe(second);

      const { service, eraser } = build();
      await service.notMe(first);
      await service.notMe(second);
      expect(eraser.eraseAccount).toHaveBeenCalledTimes(2);
    });
  });
});
