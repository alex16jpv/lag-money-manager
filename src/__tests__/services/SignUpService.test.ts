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
  signUpCodeKey,
  tokenDigest,
} from "../../app/services/authCodes";
import { EmailOutcome } from "../../app/services/EmailService";
import { SignUpService } from "../../app/services/SignUpService";
import { User } from "../../domain/entities/User";
import {
  AuthCodeRecord,
  IAuthCodeRepository,
} from "../../domain/repositories/authCode/IAuthCodeRepository";
import {
  ISignUpRepository,
  PendingSignUp,
} from "../../domain/repositories/signUp/ISignUpRepository";
import { hashEmailAddress } from "../../shared/emailHash";
import logger from "../../shared/logger";
import { mockUserRepo } from "./userRepoMock";

const NOW = new Date("2026-09-28T15:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL = "ana@example.com";
const TO_HASH = hashEmailAddress(EMAIL);
const REQUESTER = { ip: "203.0.113.7", recognizedDevice: null };
const DTO = {
  name: "Ana",
  email: EMAIL,
  password: "Offline!2026",
  locale: "es" as const,
  timezone: "America/Bogota",
};
const sent: EmailOutcome = {
  status: "sent",
  provider: "mailpit",
  messageId: "m-1",
};

const ana = (overrides: Partial<User> = {}): User =>
  new User({
    id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
    name: "Ana",
    email: EMAIL,
    password: "stored-hash",
    locale: "en",
    timezone: "Europe/Madrid",
    ...overrides,
  });

interface Harness {
  service: SignUpService;
  users: ReturnType<typeof mockUserRepo>;
  signUps: jest.Mocked<ISignUpRepository>;
  pendings: Map<string, PendingSignUp>;
  codes: jest.Mocked<
    Pick<IAuthCodeRepository, "recordRequest" | "issue" | "countAttempt">
  >;
  email: {
    holdBrakes: jest.Mock;
    sendCode: jest.Mock;
    providerCeilingMs: number;
  };
  auth: { createAccount: jest.Mock; openSession: jest.Mock };
  wait: jest.Mock;
}

const build = (): Harness => {
  const users = mockUserRepo();
  const pendings = new Map<string, PendingSignUp>();
  const signUps: jest.Mocked<ISignUpRepository> = {
    replace: jest.fn(async (pending) => {
      for (const [id, row] of pendings) {
        if (row.toHash === pending.toHash) pendings.delete(id);
      }
      pendings.set(pending.id, { ...pending, userId: null, signedInAt: null });
    }),
    findLive: jest.fn(
      async (id: string, _now: Date) => pendings.get(id) ?? null,
    ),
    claimCreation: jest.fn(async (id: string, userId: string, _now: Date) => {
      const row = pendings.get(id);
      if (!row || row.userId) return null;
      row.userId = userId;
      return row;
    }),
    releaseCreation: jest.fn(async (id, userId) => {
      const row = pendings.get(id);
      if (row?.userId === userId) row.userId = null;
    }),
    markSignedIn: jest.fn(async (id: string, _now: Date) => {
      const row = pendings.get(id);
      if (!row || row.signedInAt) return false;
      row.signedInAt = NOW;
      return true;
    }),
  };
  const codes: jest.Mocked<
    Pick<IAuthCodeRepository, "recordRequest" | "issue" | "countAttempt">
  > = {
    recordRequest: jest.fn().mockResolvedValue(undefined),
    issue: jest.fn().mockResolvedValue(undefined),
    countAttempt: jest.fn().mockResolvedValue(null),
  };
  const email = {
    holdBrakes: jest.fn().mockResolvedValue({ limited: false }),
    sendCode: jest.fn().mockResolvedValue(sent),
    providerCeilingMs: 1500,
  };
  const auth = {
    createAccount: jest.fn(async (account) =>
      ana({
        id: account.id,
        password: account.passwordHash,
        emailVerifiedAt: account.emailVerifiedAt,
      }),
    ),
    openSession: jest.fn().mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
      deviceToken: "device",
    }),
  };
  const wait = jest.fn().mockResolvedValue(undefined);
  const service = new SignUpService(
    users,
    signUps,
    codes,
    email,
    auth,
    { resendAfterSeconds: 60, floorMarginMs: 500 },
    () => NOW,
    wait,
  );
  return { service, users, signUps, pendings, codes, email, auth, wait };
};

const started = async (h: Harness): Promise<string> => {
  const answer = await h.service.start(DTO, REQUESTER);
  if (answer.status !== "accepted") throw new Error("not accepted");
  return answer.signUpToken;
};

// The code the sign-up email carried, as countAttempt would hand back its row.
const rowOf = (h: Harness, signUpToken: string): AuthCodeRecord => {
  const calls = h.email.sendCode.mock.calls;
  const { code } = calls[calls.length - 1][0].data;
  const key = signUpCodeKey(tokenDigest(signUpToken));
  return {
    id: "row",
    purpose: "sign-up",
    toHash: key,
    userId: tokenDigest(signUpToken),
    codes: [
      {
        codeHash: codeDigest(key, code),
        tokenHash: "t",
        expiresAt: new Date(NOW.getTime() + DAY_MS),
      },
    ],
    attempts: 1,
    issuedAt: NOW,
  };
};

describe("SignUpService [T-238]", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("start", () => {
    it("keeps what was typed, hashed, and mails the code that creates the account", async () => {
      const h = build();

      const answer = await h.service.start(DTO, REQUESTER);

      expect(answer).toEqual({
        status: "accepted",
        resendAfterSeconds: 60,
        signUpToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: new Date(NOW.getTime() + DAY_MS),
      });
      const pending = h.signUps.replace.mock.calls[0][0];
      expect(pending).toMatchObject({
        toHash: TO_HASH,
        email: EMAIL,
        name: "Ana",
        locale: "es",
      });
      expect(await bcryptjs.compare(DTO.password, pending.passwordHash)).toBe(
        true,
      );
      if (answer.status !== "accepted") throw new Error("not accepted");
      expect(pending.id).toBe(tokenDigest(answer.signUpToken));
      expect(h.email.sendCode).toHaveBeenCalledWith(
        expect.objectContaining({
          template: "sign-up",
          recipient: {
            userId: pending.id,
            email: EMAIL,
            locale: "es",
            timezone: "America/Bogota",
          },
          brakesHeld: true,
        }),
      );
      expect(h.codes.issue).toHaveBeenCalledWith(
        "sign-up",
        signUpCodeKey(pending.id),
        expect.objectContaining({
          expiresAt: new Date(NOW.getTime() + DAY_MS),
        }),
        false,
        NOW,
      );
    });

    it.each([
      ["live", { state: "live" as const }, { state: "live" }],
      [
        "deleted",
        {
          state: "deleted" as const,
          user: ana({
            deletedAt: new Date("2026-09-20T12:00:00Z"),
            keptUntil: new Date("2026-10-21T22:00:00Z"),
          }),
        },
        { state: "deleted", deletedOn: "2026-09-20", keptUntil: "2026-10-21" },
      ],
      [
        "held",
        { state: "held" as const, freeAt: new Date("2026-10-03T10:00:00Z") },
        { state: "held", freeOn: "2026-10-03" },
      ],
    ])(
      "answers an address with a %s account the same, and mails account-exists in its words",
      async (_label, holder, data) => {
        const h = build();
        h.users.holderOf.mockResolvedValue({ user: ana(), ...holder } as never);

        const answer = await h.service.start(DTO, REQUESTER);

        expect(answer).toMatchObject({ status: "accepted" });
        expect(h.signUps.replace).toHaveBeenCalledTimes(1);
        expect(h.email.sendCode).toHaveBeenCalledWith(
          expect.objectContaining({
            template: "account-exists",
            data,
            recipient: expect.objectContaining({
              email: EMAIL,
              locale: "en",
              timezone: "Europe/Madrid",
            }),
            brakesHeld: true,
          }),
        );
        expect(h.codes.issue).not.toHaveBeenCalled();
      },
    );

    it("holds the brakes before anything else, the same for every address", async () => {
      const h = build();
      h.email.holdBrakes.mockResolvedValue({
        limited: true,
        retryAfterSeconds: 42,
      });

      await expect(h.service.start(DTO, REQUESTER)).resolves.toEqual({
        status: "limited",
        retryAfterSeconds: 42,
      });
      expect(h.email.holdBrakes).toHaveBeenCalledWith({
        template: "sign-up",
        email: EMAIL,
        requester: REQUESTER,
      });
      expect(h.signUps.replace).not.toHaveBeenCalled();
    });

    it("never shows a send that failed, logs it, and keeps no code", async () => {
      const h = build();
      h.email.sendCode.mockRejectedValue(new Error("render bug"));

      await expect(h.service.start(DTO, REQUESTER)).resolves.toMatchObject({
        status: "accepted",
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "SIGN_UP_EMAIL_NOT_SENT" }),
        expect.any(String),
      );

      h.email.sendCode.mockResolvedValue({
        status: "failed",
        reason: "unavailable",
      });
      await h.service.start(DTO, REQUESTER);
      expect(h.codes.issue).not.toHaveBeenCalled();
    });

    it("waits until the providers' ceiling plus a margin", async () => {
      const h = build();

      await h.service.start(DTO, REQUESTER);

      const [waited] = h.wait.mock.calls[0];
      expect(waited).toBeGreaterThan(1500);
      expect(waited).toBeLessThanOrEqual(2000);
    });
  });

  describe("confirmCode", () => {
    it("creates the account confirmed and opens this browser's session, once", async () => {
      const h = build();
      const token = await started(h);
      h.codes.countAttempt.mockResolvedValue(rowOf(h, token));
      const { code } = h.email.sendCode.mock.calls[0][0].data;

      const result = await h.service.confirmCode(token, code, "Mozilla");

      expect(h.auth.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          email: EMAIL,
          name: "Ana",
          emailVerifiedAt: NOW,
          passwordHash: h.signUps.replace.mock.calls[0][0].passwordHash,
        }),
      );
      expect(h.auth.openSession).toHaveBeenCalledWith(
        expect.objectContaining({ email: EMAIL }),
        "Mozilla",
      );
      expect(result).toMatchObject({ accessToken: "access" });

      await expect(h.service.confirmCode(token, code)).rejects.toMatchObject({
        code: "SIGN_UP_CODE_INVALID",
      });
      expect(h.auth.openSession).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["a wrong code", (h: Harness, t: string) => rowOf(h, t), "111111"],
      ["no row", () => null, "111111"],
      [
        "a row of another sign-up of the address",
        (h: Harness, t: string) => ({ ...rowOf(h, t), userId: "other" }),
        undefined,
      ],
    ])(
      "gives %s the one answer and creates nothing",
      async (_label, row, code) => {
        const h = build();
        const token = await started(h);
        h.codes.countAttempt.mockResolvedValue(row(h, token));

        await expect(
          h.service.confirmCode(
            token,
            code ?? h.email.sendCode.mock.calls[0][0].data.code,
          ),
        ).rejects.toMatchObject({
          statusCode: 400,
          code: "SIGN_UP_CODE_INVALID",
        });
        expect(h.auth.createAccount).not.toHaveBeenCalled();
      },
    );

    it("gives a sign-up that is over the same answer", async () => {
      const h = build();

      await expect(
        h.service.confirmCode(
          "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPzq7Xk2mVb9Rt",
          "123456",
        ),
      ).rejects.toMatchObject({ code: "SIGN_UP_CODE_INVALID" });
    });

    it("signs in to the account the link created, while its password is the one typed here", async () => {
      const h = build();
      const token = await started(h);
      h.codes.countAttempt.mockResolvedValue(rowOf(h, token));
      const { code } = h.email.sendCode.mock.calls[0][0].data;
      await h.service.confirmLink(rowOf(h, token));
      const created = await h.auth.createAccount.mock.results[0].value;
      h.users.getByIdWithPassword.mockResolvedValue(created);

      await expect(h.service.confirmCode(token, code)).resolves.toMatchObject({
        accessToken: "access",
      });
      expect(h.auth.createAccount).toHaveBeenCalledTimes(1);

      const h2 = build();
      const token2 = await started(h2);
      h2.codes.countAttempt.mockResolvedValue(rowOf(h2, token2));
      await h2.service.confirmLink(rowOf(h2, token2));
      h2.users.getByIdWithPassword.mockResolvedValue(
        ana({ password: "changed since" }),
      );
      await expect(
        h2.service.confirmCode(
          token2,
          h2.email.sendCode.mock.calls[0][0].data.code,
        ),
      ).rejects.toMatchObject({ code: "SIGN_UP_CODE_INVALID" });
    });

    it("frees the claim when the account cannot be created, and lets EMAIL_TAKEN through", async () => {
      const h = build();
      const token = await started(h);
      h.codes.countAttempt.mockResolvedValue(rowOf(h, token));
      const taken = Object.assign(new Error("taken"), {
        statusCode: 409,
        code: "EMAIL_TAKEN",
      });
      h.auth.createAccount.mockRejectedValueOnce(taken);

      await expect(
        h.service.confirmCode(
          token,
          h.email.sendCode.mock.calls[0][0].data.code,
        ),
      ).rejects.toBe(taken);
      expect(h.pendings.get(tokenDigest(token))?.userId).toBeNull();
    });
  });

  describe("confirmLink", () => {
    it("creates the account with no session, and finds it again on a second tap", async () => {
      const h = build();
      const token = await started(h);
      const row = rowOf(h, token);

      await h.service.confirmLink(row);
      const created = await h.auth.createAccount.mock.results[0].value;
      h.users.getByIdWithPassword.mockResolvedValue(created);
      await h.service.confirmLink(row);

      expect(h.auth.createAccount).toHaveBeenCalledTimes(1);
      expect(h.auth.openSession).not.toHaveBeenCalled();
    });

    it("never takes the code or link of a sign-up another one replaced, even under the new one's id", async () => {
      const h = build();
      const first = await started(h);
      const oldRow = rowOf(h, first);
      const second = await started(h);

      await expect(
        h.service.confirmLink({ ...oldRow, userId: tokenDigest(second) }),
      ).rejects.toMatchObject({ code: "LINK_INVALID" });
      h.codes.countAttempt.mockResolvedValue({
        ...oldRow,
        userId: tokenDigest(second),
      });
      await expect(
        h.service.confirmCode(
          second,
          h.email.sendCode.mock.calls[0][0].data.code,
        ),
      ).rejects.toMatchObject({ code: "SIGN_UP_CODE_INVALID" });
      expect(h.auth.createAccount).not.toHaveBeenCalled();
    });

    it("refuses a row whose sign-up is over or is of another address", async () => {
      const h = build();
      const token = await started(h);

      await expect(
        h.service.confirmLink({ ...rowOf(h, token), userId: "gone" }),
      ).rejects.toMatchObject({ code: "LINK_INVALID" });
      await expect(
        h.service.confirmLink({ ...rowOf(h, token), toHash: "other" }),
      ).rejects.toMatchObject({ code: "LINK_INVALID" });
    });
  });

  describe("resend", () => {
    it("sends again under the same brakes and floor", async () => {
      const h = build();
      const token = await started(h);
      h.wait.mockClear();

      await expect(h.service.resend(token, REQUESTER)).resolves.toEqual({
        status: "accepted",
        resendAfterSeconds: 60,
      });
      expect(h.email.holdBrakes).toHaveBeenCalledTimes(2);
      expect(h.email.sendCode).toHaveBeenCalledTimes(2);
      expect(h.wait).toHaveBeenCalledTimes(1);
    });

    it("says SIGN_UP_EXPIRED for a sign-up that is over", async () => {
      const h = build();

      await expect(
        h.service.resend(
          "q7Xk2mVb9RtL4wPzq7Xk2mVb9RtL4wPzq7Xk2mVb9Rt",
          REQUESTER,
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: "SIGN_UP_EXPIRED" });
      expect(h.email.holdBrakes).not.toHaveBeenCalled();
    });
  });
});
