import bcryptjs from "bcryptjs";

import {
  accountLinkOwner,
  codeDigest,
  emailChangeKey,
  newAccountLinkToken,
  tokenDigest,
} from "../../app/services/authCodes";
import { EmailChangeService } from "../../app/services/EmailChangeService";
import { EmailOutcome } from "../../app/services/EmailService";
import { PendingEmailChange, User } from "../../domain/entities/User";
import {
  AuthCodeRecord,
  IAuthCodeRepository,
} from "../../domain/repositories/authCode/IAuthCodeRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { hashEmailAddress } from "../../shared/emailHash";
import logger from "../../shared/logger";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const USER_ID = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const EMAIL = "ana@example.com";
const NEW_EMAIL = "ana.ruiz@example.org";
const NEW_KEY = emailChangeKey(USER_ID, NEW_EMAIL);
const PASSWORD = "Offline!2026";
const PASSWORD_HASH = bcryptjs.hashSync(PASSWORD, 4);
const REQUESTER = { ip: "203.0.113.7", recognizedDevice: null };
const TOKENS = {
  accessToken: "access",
  refreshToken: "refresh",
  deviceToken: "device",
};

const pendingChange = (
  overrides: Partial<PendingEmailChange> = {},
): PendingEmailChange => ({
  email: NEW_EMAIL,
  sentAt: new Date(NOW.getTime() - 20_000),
  expiresAt: new Date(NOW.getTime() + DAY_MS - 20_000),
  ...overrides,
});

const ana = (overrides: Partial<User> = {}): User =>
  new User({
    id: USER_ID,
    name: "Ana",
    email: EMAIL,
    password: PASSWORD_HASH,
    locale: "es",
    timezone: "America/Bogota",
    emailVerifiedAt: new Date("2026-09-01T00:00:00.000Z"),
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  });

const moved = (): User =>
  ana({
    email: NEW_EMAIL,
    emailVerifiedAt: NOW,
    tokenVersion: 1,
  });

const record = (overrides: Partial<AuthCodeRecord> = {}): AuthCodeRecord => ({
  id: "code-row",
  purpose: "email-change",
  toHash: NEW_KEY,
  userId: USER_ID,
  codes: [
    {
      codeHash: codeDigest(NEW_KEY, "123456"),
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
  service: EmailChangeService;
  users: Record<
    | "getById"
    | "getByIdWithPassword"
    | "holderOf"
    | "startEmailChange"
    | "renewEmailChange"
    | "dropEmailChange"
    | "applyEmailChange"
    | "addUndoLink"
    | "dropUndoLink"
    | "getForUndo"
    | "undoEmailChange",
    jest.Mock
  >;
  codes: jest.Mocked<IAuthCodeRepository>;
  email: { sendCode: jest.Mock; sendNotice: jest.Mock };
  invitations: { touchUnansweredFor: jest.Mock };
  sessions: { revokeAllForUser: jest.Mock };
  auth: { openSession: jest.Mock; isLiveSessionOf: jest.Mock };
}

const build = (): Harness => {
  const users = {
    getById: jest.fn().mockResolvedValue(ana({ emailChange: pendingChange() })),
    getByIdWithPassword: jest.fn().mockResolvedValue(ana()),
    holderOf: jest.fn().mockResolvedValue(null),
    startEmailChange: jest.fn(async (_id: string, change: PendingEmailChange) =>
      ana({ emailChange: change }),
    ),
    renewEmailChange: jest.fn(async () =>
      ana({ emailChange: pendingChange() }),
    ),
    dropEmailChange: jest.fn().mockResolvedValue(undefined),
    applyEmailChange: jest.fn(async () => moved()),
    addUndoLink: jest.fn().mockResolvedValue(true),
    dropUndoLink: jest.fn().mockResolvedValue(undefined),
    getForUndo: jest.fn().mockResolvedValue(null),
    undoEmailChange: jest.fn(async () =>
      ana({ emailVerifiedAt: NOW, tokenVersion: 2 }),
    ),
  };
  const codes: jest.Mocked<IAuthCodeRepository> = {
    recordRequest: jest.fn().mockResolvedValue(undefined),
    issue: jest.fn().mockResolvedValue(undefined),
    countAttempt: jest.fn().mockResolvedValue(record()),
    redeemCode: jest.fn().mockResolvedValue(record()),
    redeemToken: jest.fn().mockResolvedValue(record()),
    find: jest.fn().mockResolvedValue(null),
    findByLiveToken: jest.fn().mockResolvedValue(null),
    discard: jest.fn().mockResolvedValue(undefined),
  };
  const email = {
    sendCode: jest.fn().mockResolvedValue(sent),
    sendNotice: jest.fn().mockResolvedValue(sent),
  };
  const invitations = {
    touchUnansweredFor: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
  const auth = {
    openSession: jest.fn().mockResolvedValue(TOKENS),
    isLiveSessionOf: jest.fn().mockResolvedValue(true),
  };
  const service = new EmailChangeService(
    users as unknown as IUserRepository,
    codes,
    email,
    invitations,
    sessions,
    auth,
    { resendAfterSeconds: 60 },
    () => NOW,
  );
  return { service, users, codes, email, invitations, sessions, auth };
};

const rejects = async (
  promise: Promise<unknown>,
  code: string,
  statusCode?: number,
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({
    code,
    ...(statusCode ? { statusCode } : {}),
  });
};

describe("EmailChangeService [T-221]", () => {
  describe("request", () => {
    it("emails a code and a link to the new address and only then saves the change", async () => {
      const { service, email, codes, users } = build();

      const result = await service.request(
        USER_ID,
        NEW_EMAIL,
        PASSWORD,
        REQUESTER,
      );

      const sendRequest = email.sendCode.mock.calls[0][0];
      expect(sendRequest).toMatchObject({
        template: "email-change-confirm",
        recipient: {
          userId: USER_ID,
          email: NEW_EMAIL,
          locale: "es",
          timezone: "America/Bogota",
        },
        requester: REQUESTER,
      });
      const { code, token } = sendRequest.data;
      expect(code).toMatch(/^\d{6}$/);
      expect(codes.recordRequest).toHaveBeenCalledWith(
        "email-change",
        NEW_KEY,
        USER_ID,
        new Date(NOW.getTime() + DAY_MS),
      );
      expect(codes.issue).toHaveBeenCalledWith(
        "email-change",
        NEW_KEY,
        {
          codeHash: codeDigest(NEW_KEY, code),
          tokenHash: tokenDigest(token),
          expiresAt: new Date(NOW.getTime() + DAY_MS),
        },
        false,
        NOW,
      );
      expect(users.startEmailChange).toHaveBeenCalledWith(USER_ID, {
        email: NEW_EMAIL,
        sentAt: NOW,
        expiresAt: new Date(NOW.getTime() + DAY_MS),
      });
      expect(result).toEqual({
        status: "sent",
        emailChange: {
          email: NEW_EMAIL,
          expiresAt: new Date(NOW.getTime() + DAY_MS),
          resendAvailableAt: new Date(NOW.getTime() + 60_000),
        },
      });
    });

    it("keys the codes by the account and the address, so another account asking for it keeps its own [review]", () => {
      expect(emailChangeKey(USER_ID, NEW_EMAIL)).not.toBe(
        emailChangeKey("019576a0-d7b6-7d6d-af6a-2b7545f5ac71", NEW_EMAIL),
      );
      expect(emailChangeKey(USER_ID, " Ana.Ruiz@Example.org ")).toBe(NEW_KEY);
      expect(NEW_KEY).not.toBe(hashEmailAddress(NEW_EMAIL));
    });

    it("stops the code and link of the address it replaces, once the new one is saved", async () => {
      const { service, users, codes } = build();
      users.getByIdWithPassword.mockResolvedValue(
        ana({ emailChange: pendingChange({ email: "first@example.org" }) }),
      );

      await service.request(USER_ID, NEW_EMAIL, PASSWORD, REQUESTER);

      expect(codes.discard).toHaveBeenCalledWith(
        "email-change",
        emailChangeKey(USER_ID, "first@example.org"),
      );
      expect(codes.discard.mock.invocationCallOrder[0]).toBeGreaterThan(
        users.startEmailChange.mock.invocationCallOrder[0],
      );
    });

    it("discards nothing when it asks again for the address that waits, or when the email did not go", async () => {
      const { service, users, codes, email } = build();
      users.getByIdWithPassword.mockResolvedValue(
        ana({ emailChange: pendingChange() }),
      );

      await service.request(USER_ID, NEW_EMAIL, PASSWORD, REQUESTER);
      users.getByIdWithPassword.mockResolvedValue(
        ana({ emailChange: pendingChange({ email: "first@example.org" }) }),
      );
      email.sendCode.mockResolvedValue({
        status: "failed",
        reason: "rejected",
      });
      await service.request(USER_ID, NEW_EMAIL, PASSWORD, REQUESTER);

      expect(codes.discard).not.toHaveBeenCalled();
    });

    it("moves nothing and sends nothing without the current password", async () => {
      const { service, email, users } = build();

      await rejects(
        service.request(USER_ID, NEW_EMAIL, "wrong-password", REQUESTER),
        "CURRENT_PASSWORD_INVALID",
        401,
      );
      expect(email.sendCode).not.toHaveBeenCalled();
      expect(users.startEmailChange).not.toHaveBeenCalled();
    });

    it("refuses the account's own address as a validation error of the field", async () => {
      const { service, email } = build();

      await expect(
        service.request(USER_ID, EMAIL, PASSWORD, REQUESTER),
      ).rejects.toMatchObject({
        code: "VALIDATION",
        statusCode: 400,
        details: [{ field: "email" }],
      });
      expect(email.sendCode).not.toHaveBeenCalled();
    });

    it("waits for an address another account holds as for any other, telling that inbox instead of sending a code [T-238]", async () => {
      const { service, users, email, codes } = build();
      users.holderOf.mockResolvedValue({ state: "live", user: ana() });

      const result = await service.request(
        USER_ID,
        NEW_EMAIL,
        PASSWORD,
        REQUESTER,
      );

      expect(users.holderOf).toHaveBeenCalledWith(NEW_EMAIL, NOW, USER_ID);
      expect(email.sendCode).toHaveBeenCalledTimes(1);
      expect(email.sendCode.mock.calls[0][0]).toMatchObject({
        template: "email-change-taken",
        data: {},
        recipient: { email: NEW_EMAIL },
        requester: REQUESTER,
      });
      expect(codes.issue).toHaveBeenCalledWith(
        "email-change",
        NEW_KEY,
        expect.objectContaining({ codeHash: expect.any(String) }),
        false,
        NOW,
      );
      expect(email.sendNotice).toHaveBeenCalledWith(
        expect.objectContaining({ template: "email-change-requested" }),
      );
      expect(result).toEqual({
        status: "sent",
        emailChange: {
          email: NEW_EMAIL,
          expiresAt: new Date(NOW.getTime() + DAY_MS),
          resendAvailableAt: new Date(NOW.getTime() + 60_000),
        },
      });
    });

    it("names the account that moves, by its current address, in the code email [T-236]", async () => {
      const { service, email } = build();

      await service.request(USER_ID, NEW_EMAIL, PASSWORD, REQUESTER);

      expect(email.sendCode.mock.calls[0][0].data.currentEmail).toBe(EMAIL);
    });

    it("answers 404 for an account that is gone", async () => {
      const { service, users } = build();
      users.getByIdWithPassword.mockResolvedValue(null);

      await expect(
        service.request(USER_ID, NEW_EMAIL, PASSWORD, REQUESTER),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it.each([
      [{ status: "limited", retryAfterSeconds: 42 }],
      [{ status: "failed", reason: "rejected" }],
      [{ status: "failed", reason: "unavailable" }],
      [{ status: "failed", reason: "disabled" }],
    ] as EmailOutcome[][])(
      "leaves the account as it was when the email did not go: %o",
      async (outcome) => {
        const { service, email, users, codes } = build();
        email.sendCode.mockResolvedValue(outcome);

        await expect(
          service.request(USER_ID, NEW_EMAIL, PASSWORD, REQUESTER),
        ).resolves.toEqual(outcome);
        expect(users.startEmailChange).not.toHaveBeenCalled();
        expect(codes.issue).not.toHaveBeenCalled();
      },
    );

    it("saves the change when the email may have gone, keeping the code that was live next to the new one", async () => {
      const { service, email, users, codes } = build();
      email.sendCode.mockResolvedValue({
        status: "failed",
        reason: "unconfirmed",
      });

      const result = await service.request(
        USER_ID,
        NEW_EMAIL,
        PASSWORD,
        REQUESTER,
      );

      expect(result.status).toBe("sent");
      expect(codes.issue.mock.calls[0][3]).toBe(true);
      expect(users.startEmailChange).toHaveBeenCalled();
    });
  });

  describe("the notice to the old address [T-211]", () => {
    it("tells a confirmed old address the new one, with a link to undo it for 7 days, before saving the change", async () => {
      const { service, email, users } = build();

      await service.request(USER_ID, NEW_EMAIL, PASSWORD, REQUESTER, "Mozilla");

      expect(email.sendNotice).toHaveBeenCalledTimes(1);
      const notice = email.sendNotice.mock.calls[0][0];
      expect(notice).toMatchObject({
        template: "email-change-requested",
        data: { at: NOW, userAgent: "Mozilla", newEmail: NEW_EMAIL },
        recipient: {
          userId: USER_ID,
          email: EMAIL,
          locale: "es",
          timezone: "America/Bogota",
        },
      });
      const { undoToken } = notice.data;
      expect(accountLinkOwner(undoToken)).toBe(USER_ID);
      expect(users.addUndoLink).toHaveBeenCalledWith(
        USER_ID,
        {
          email: EMAIL,
          tokenHash: tokenDigest(undoToken),
          expiresAt: new Date(NOW.getTime() + WEEK_MS),
        },
        NOW,
      );
      const order = (mock: jest.Mock): number =>
        mock.mock.invocationCallOrder[0];
      expect(order(users.addUndoLink)).toBeLessThan(order(email.sendNotice));
      expect(order(email.sendNotice)).toBeLessThan(
        order(users.startEmailChange),
      );
      expect(users.dropUndoLink).not.toHaveBeenCalled();
    });

    it("tells an address that was never confirmed nothing, and keeps no undo link", async () => {
      const { service, email, users } = build();
      users.getByIdWithPassword.mockResolvedValue(
        ana({ emailVerifiedAt: null }),
      );

      const result = await service.request(
        USER_ID,
        NEW_EMAIL,
        PASSWORD,
        REQUESTER,
      );

      expect(result.status).toBe("sent");
      expect(email.sendNotice).not.toHaveBeenCalled();
      expect(users.addUndoLink).not.toHaveBeenCalled();
      expect(users.startEmailChange).toHaveBeenCalled();
    });

    it("saves nothing, and says why, when a brake or a cap stops the notice [owner, 2026-09-28]", async () => {
      const { service, email, users } = build();
      email.sendNotice.mockResolvedValue({
        status: "limited",
        retryAfterSeconds: 40,
      });

      const result = await service.request(
        USER_ID,
        NEW_EMAIL,
        PASSWORD,
        REQUESTER,
      );

      expect(result).toEqual({ status: "limited", retryAfterSeconds: 40 });
      const { tokenHash } = users.addUndoLink.mock.calls[0][1];
      expect(users.dropUndoLink).toHaveBeenCalledWith(USER_ID, tokenHash);
      expect(users.startEmailChange).not.toHaveBeenCalled();
    });

    it("saves nothing when no provider could take the notice", async () => {
      const { service, email, users } = build();
      email.sendNotice.mockResolvedValue({
        status: "failed",
        reason: "unavailable",
      });

      const result = await service.request(
        USER_ID,
        NEW_EMAIL,
        PASSWORD,
        REQUESTER,
      );

      expect(result).toEqual({ status: "failed", reason: "unavailable" });
      expect(users.startEmailChange).not.toHaveBeenCalled();
    });

    it("lets an account leave an old address that refuses all email, with no undo link", async () => {
      const { service, email, users } = build();
      email.sendNotice.mockResolvedValue({
        status: "failed",
        reason: "rejected",
      });

      const result = await service.request(
        USER_ID,
        NEW_EMAIL,
        PASSWORD,
        REQUESTER,
      );

      expect(result.status).toBe("sent");
      expect(users.dropUndoLink).toHaveBeenCalled();
      expect(users.startEmailChange).toHaveBeenCalled();
    });

    it("keeps the undo link when the notice may still arrive", async () => {
      const { service, email, users } = build();
      email.sendNotice.mockResolvedValue({
        status: "failed",
        reason: "unconfirmed",
      });

      await service.request(USER_ID, NEW_EMAIL, PASSWORD, REQUESTER);

      expect(users.dropUndoLink).not.toHaveBeenCalled();
      expect(users.startEmailChange).toHaveBeenCalled();
    });

    it("tells the old address nothing when the new one's email did not go", async () => {
      const { service, email, users } = build();
      email.sendCode.mockResolvedValue({
        status: "failed",
        reason: "rejected",
      });

      await service.request(USER_ID, NEW_EMAIL, PASSWORD, REQUESTER);

      expect(email.sendNotice).not.toHaveBeenCalled();
      expect(users.addUndoLink).not.toHaveBeenCalled();
      expect(users.startEmailChange).not.toHaveBeenCalled();
    });
  });

  describe("undo [T-211]", () => {
    const token = newAccountLinkToken(USER_ID);
    const link = {
      email: EMAIL,
      tokenHash: tokenDigest(token),
      expiresAt: new Date(NOW.getTime() + WEEK_MS - 1000),
    };
    const movedWithLink = (): User =>
      ana({ email: NEW_EMAIL, undoLinks: [link] });

    it("puts the account back at the address the link reached and mails it a code to choose a password", async () => {
      const { service, users, sessions, codes, email, invitations } = build();
      users.getForUndo.mockResolvedValue(movedWithLink());

      const result = await service.undo(token);

      const [id, used, unusable, at] = users.undoEmailChange.mock.calls[0];
      expect(id).toBe(USER_ID);
      expect(used).toEqual(link);
      expect(at).toBe(NOW);
      expect(await bcryptjs.compare(PASSWORD, unusable)).toBe(false);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
      expect(invitations.touchUnansweredFor).toHaveBeenCalledWith(EMAIL, NOW);
      const toHash = hashEmailAddress(EMAIL);
      expect(codes.recordRequest).toHaveBeenCalledWith(
        "reset",
        toHash,
        USER_ID,
        new Date(NOW.getTime() + 30 * 60 * 1000),
      );
      const sendRequest = email.sendCode.mock.calls[0][0];
      expect(sendRequest).toMatchObject({
        template: "password-reset-after-undo",
        recipient: { userId: USER_ID, email: EMAIL, locale: "es" },
        requester: null,
        brakesHeld: false,
      });
      expect(codes.issue).toHaveBeenCalledWith(
        "reset",
        toHash,
        {
          codeHash: codeDigest(toHash, sendRequest.data.code),
          tokenHash: tokenDigest(sendRequest.data.token),
          expiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
        },
        false,
        NOW,
      );
      expect(email.sendNotice).not.toHaveBeenCalled();
      expect(result).toEqual({ email: EMAIL, codeSent: true });
    });

    it("cancels a change that still waits, with its code and link", async () => {
      const { service, users, codes, invitations } = build();
      users.getForUndo.mockResolvedValue(
        ana({ emailChange: pendingChange(), undoLinks: [link] }),
      );

      await service.undo(token);

      expect(codes.discard).toHaveBeenCalledWith("email-change", NEW_KEY);
      expect(invitations.touchUnansweredFor).not.toHaveBeenCalled();
    });

    it("says LINK_INVALID for a token that is not a link of the account, and does nothing", async () => {
      const { service, users } = build();
      users.getForUndo.mockResolvedValue(movedWithLink());

      await rejects(
        service.undo(newAccountLinkToken(USER_ID)),
        "LINK_INVALID",
        400,
      );
      await rejects(service.undo("x".repeat(64)), "LINK_INVALID");
      expect(users.undoEmailChange).not.toHaveBeenCalled();
    });

    it("names its account in a token of 64 characters, and reads nothing else as one", () => {
      expect(token).toMatch(/^[A-Za-z0-9_-]{64}$/);
      expect(accountLinkOwner(token)).toBe(USER_ID);
      expect(newAccountLinkToken(USER_ID)).not.toBe(token);
      expect(accountLinkOwner(token.slice(0, 63))).toBeNull();
      expect(accountLinkOwner(`${token.slice(0, 63)}!`)).toBeNull();
    });

    it("says LINK_INVALID once the link's 7 days passed", async () => {
      const { service, users } = build();
      users.getForUndo.mockResolvedValue(
        ana({ undoLinks: [{ ...link, expiresAt: NOW }] }),
      );

      await rejects(service.undo(token), "LINK_INVALID");
      expect(users.undoEmailChange).not.toHaveBeenCalled();
    });

    it("says LINK_INVALID when the account is gone, or the link was spent between the read and the write", async () => {
      const { service, users, email } = build();
      users.getForUndo.mockResolvedValueOnce(null);
      await rejects(service.undo(token), "LINK_INVALID");

      users.getForUndo.mockResolvedValue(movedWithLink());
      users.undoEmailChange.mockResolvedValue(null);
      await rejects(service.undo(token), "LINK_INVALID");
      expect(email.sendCode).not.toHaveBeenCalled();
    });

    it("answers codeSent false when the code could not go, and the undo stands", async () => {
      const { service, users, email, codes } = build();
      users.getForUndo.mockResolvedValue(movedWithLink());
      email.sendCode.mockResolvedValue({
        status: "failed",
        reason: "rejected",
      });

      const result = await service.undo(token);

      expect(result).toEqual({ email: EMAIL, codeSent: false });
      expect(codes.issue).not.toHaveBeenCalled();
    });

    it("answers codeSent false and logs it when sending the code throws", async () => {
      const { service, users, email } = build();
      users.getForUndo.mockResolvedValue(movedWithLink());
      email.sendCode.mockRejectedValue(new Error("render bug"));
      const error = jest.spyOn(logger, "error").mockImplementation();

      const result = await service.undo(token);

      expect(result).toEqual({ email: EMAIL, codeSent: false });
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "UNDO_RESET_CODE_NOT_SENT" }),
        expect.any(String),
      );
      error.mockRestore();
    });
  });

  describe("resend", () => {
    it("mails the address that waits again and gives the change 24 hours from now", async () => {
      const { service, email, users } = build();

      const result = await service.resend(USER_ID, REQUESTER);

      expect(email.sendCode.mock.calls[0][0].recipient.email).toBe(NEW_EMAIL);
      expect(users.renewEmailChange).toHaveBeenCalledWith(
        USER_ID,
        NEW_EMAIL,
        NOW,
        new Date(NOW.getTime() + DAY_MS),
      );
      expect(result.status).toBe("sent");
    });

    it.each([
      ["nothing waits", null],
      [
        "its 24 hours passed",
        pendingChange({ expiresAt: new Date(NOW.getTime() - 1) }),
      ],
    ])("says EMAIL_CHANGE_NOT_PENDING when %s", async (_label, change) => {
      const { service, users, email } = build();
      users.getById.mockResolvedValue(ana({ emailChange: change }));

      await rejects(
        service.resend(USER_ID, REQUESTER),
        "EMAIL_CHANGE_NOT_PENDING",
        409,
      );
      expect(email.sendCode).not.toHaveBeenCalled();
    });

    it("says EMAIL_CHANGE_NOT_PENDING when the change was cancelled while the email went", async () => {
      const { service, users } = build();
      users.renewEmailChange.mockResolvedValue(null);

      await rejects(
        service.resend(USER_ID, REQUESTER),
        "EMAIL_CHANGE_NOT_PENDING",
      );
    });

    it("keeps the change as it was when the email did not go", async () => {
      const { service, users, email } = build();
      email.sendCode.mockResolvedValue({
        status: "limited",
        retryAfterSeconds: 30,
      });

      await expect(service.resend(USER_ID, REQUESTER)).resolves.toEqual({
        status: "limited",
        retryAfterSeconds: 30,
      });
      expect(users.renewEmailChange).not.toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("drops whatever waits, and its code and link stop working", async () => {
      const { service, users, codes } = build();

      await service.cancel(USER_ID);

      expect(users.dropEmailChange).toHaveBeenCalledWith(USER_ID);
      expect(codes.discard).toHaveBeenCalledWith("email-change", NEW_KEY);
    });

    it("discards nothing when nothing waited", async () => {
      const { service, users, codes } = build();
      users.getById.mockResolvedValue(ana());

      await service.cancel(USER_ID);

      expect(codes.discard).not.toHaveBeenCalled();
    });
  });

  describe("view", () => {
    it("shows the address that waits, when it goes, and Resend's countdown", () => {
      const { service } = build();

      expect(service.view(ana({ emailChange: pendingChange() }))).toEqual({
        email: NEW_EMAIL,
        expiresAt: pendingChange().expiresAt,
        resendAvailableAt: new Date(NOW.getTime() + 40_000),
      });
    });

    it("lets Resend go now once the interval passed", () => {
      const { service } = build();
      const change = pendingChange({
        sentAt: new Date(NOW.getTime() - 60_000),
      });

      expect(
        service.view(ana({ emailChange: change }))?.resendAvailableAt,
      ).toBe(null);
    });

    it("shows nothing when nothing waits or its 24 hours passed", () => {
      const { service } = build();

      expect(service.view(ana())).toBeNull();
      expect(
        service.view(ana({ emailChange: pendingChange({ expiresAt: NOW }) })),
      ).toBeNull();
    });
  });

  describe("confirmCode", () => {
    it("moves the account, signs out every session and opens a new one for this device", async () => {
      const { service, codes, users, sessions, invitations, auth } = build();

      const result = await service.confirmCode(USER_ID, "123456", "Firefox");

      expect(codes.countAttempt).toHaveBeenCalledWith(
        "email-change",
        NEW_KEY,
        5,
      );
      expect(codes.redeemCode).toHaveBeenCalledWith(
        "code-row",
        codeDigest(NEW_KEY, "123456"),
        NOW,
      );
      expect(users.applyEmailChange).toHaveBeenCalledWith(
        USER_ID,
        NEW_EMAIL,
        NOW,
      );
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
      expect(invitations.touchUnansweredFor).toHaveBeenCalledWith(
        NEW_EMAIL,
        NOW,
      );
      expect(auth.openSession).toHaveBeenCalledWith(moved(), "Firefox");
      expect(
        sessions.revokeAllForUser.mock.invocationCallOrder[0],
      ).toBeLessThan(auth.openSession.mock.invocationCallOrder[0]);
      expect(result).toMatchObject({
        ...TOKENS,
        user: { email: NEW_EMAIL, emailVerified: true },
      });
    });

    it("says EMAIL_CODE_INVALID for a code that is not the one sent, and moves nothing", async () => {
      const { service, codes, users } = build();
      codes.redeemCode.mockResolvedValue(null);

      await rejects(
        service.confirmCode(USER_ID, "654321"),
        "EMAIL_CODE_INVALID",
        400,
      );
      expect(users.applyEmailChange).not.toHaveBeenCalled();
    });

    it.each([
      ["its five tries are spent", null],
      ["its code expired", record({ codes: [] })],
      [
        "another account asked for the address since",
        record({ userId: "other" }),
      ],
    ])("says EMAIL_CODE_EXPIRED when %s", async (_label, counted) => {
      const { service, codes, users } = build();
      codes.countAttempt.mockResolvedValue(counted);

      await rejects(
        service.confirmCode(USER_ID, "123456"),
        "EMAIL_CODE_EXPIRED",
        400,
      );
      expect(codes.redeemCode).not.toHaveBeenCalled();
      expect(users.applyEmailChange).not.toHaveBeenCalled();
    });

    it("says EMAIL_CHANGE_NOT_PENDING when nothing waits, before counting a try", async () => {
      const { service, users, codes } = build();
      users.getById.mockResolvedValue(ana());

      await rejects(
        service.confirmCode(USER_ID, "123456"),
        "EMAIL_CHANGE_NOT_PENDING",
        409,
      );
      expect(codes.countAttempt).not.toHaveBeenCalled();
    });

    it("drops the change and says EMAIL_TAKEN when the address became another account's", async () => {
      const { service, users, sessions, auth, codes } = build();
      users.applyEmailChange.mockResolvedValue("taken");

      await rejects(service.confirmCode(USER_ID, "123456"), "EMAIL_TAKEN", 409);
      expect(users.dropEmailChange).toHaveBeenCalledWith(USER_ID, NEW_EMAIL);
      expect(codes.discard).toHaveBeenCalledWith("email-change", NEW_KEY);
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      expect(auth.openSession).not.toHaveBeenCalled();
    });

    it("says EMAIL_CHANGE_NOT_PENDING when the change went between the read and the write", async () => {
      const { service, users, sessions } = build();
      users.applyEmailChange.mockResolvedValue(null);

      await rejects(
        service.confirmCode(USER_ID, "123456"),
        "EMAIL_CHANGE_NOT_PENDING",
      );
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe("confirmLink", () => {
    it("moves the account and keeps this browser's session when it had one of the account", async () => {
      const { service, codes, users, auth, sessions } = build();

      const result = await service.confirmLink(
        "link-token-of-the-email",
        "browser-refresh",
        "Safari",
      );

      expect(codes.redeemToken).toHaveBeenCalledWith(
        "email-change",
        tokenDigest("link-token-of-the-email"),
        NOW,
      );
      expect(auth.isLiveSessionOf).toHaveBeenCalledWith(
        "browser-refresh",
        ana({ emailChange: pendingChange() }),
      );
      expect(auth.isLiveSessionOf.mock.invocationCallOrder[0]).toBeLessThan(
        users.applyEmailChange.mock.invocationCallOrder[0],
      );
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
      expect(auth.openSession).toHaveBeenCalledWith(moved(), "Safari");
      expect(result).toMatchObject({ ...TOKENS, user: { email: NEW_EMAIL } });
    });

    it("moves the account and opens no session without one of the account", async () => {
      const { service, auth } = build();
      auth.isLiveSessionOf.mockResolvedValue(false);

      const result = await service.confirmLink(
        "link-token-of-the-email",
        "someone-elses-refresh",
      );

      expect(auth.openSession).not.toHaveBeenCalled();
      expect(result).toEqual({
        user: expect.objectContaining({ email: NEW_EMAIL }),
      });
    });

    it("asks about no session when the browser sent none", async () => {
      const { service, auth } = build();

      const result = await service.confirmLink(
        "link-token-of-the-email",
        undefined,
      );

      expect(auth.isLiveSessionOf).not.toHaveBeenCalled();
      expect(auth.openSession).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty("accessToken");
    });

    it.each([
      ["a spent, expired or unknown token", { redeemed: null }],
      ["a row with no account", { redeemed: record({ userId: null }) }],
      [
        "a change replaced by another address",
        {
          redeemed: record({
            toHash: emailChangeKey(USER_ID, "first@example.org"),
          }),
        },
      ],
      ["a change cancelled or expired", { user: ana() }],
      ["an account that is gone", { user: null }],
    ] as [string, { redeemed?: AuthCodeRecord | null; user?: User | null }][])(
      "says LINK_INVALID for %s, and moves nothing",
      async (_label, { redeemed, user }) => {
        const { service, codes, users } = build();
        if (redeemed !== undefined)
          codes.redeemToken.mockResolvedValue(redeemed);
        if (user !== undefined) users.getById.mockResolvedValue(user);

        await rejects(
          service.confirmLink("link-token-of-the-email", undefined),
          "LINK_INVALID",
          400,
        );
        expect(users.applyEmailChange).not.toHaveBeenCalled();
      },
    );

    it("says EMAIL_TAKEN and drops the change when the address became another account's", async () => {
      const { service, users } = build();
      users.applyEmailChange.mockResolvedValue("taken");

      await rejects(
        service.confirmLink("link-token-of-the-email", undefined),
        "EMAIL_TAKEN",
        409,
      );
      expect(users.dropEmailChange).toHaveBeenCalledWith(USER_ID, NEW_EMAIL);
    });
  });
});
