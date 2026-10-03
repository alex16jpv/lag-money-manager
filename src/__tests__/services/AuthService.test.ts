import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";

import { AuthService } from "../../app/services/AuthService";
import { CategoryService } from "../../app/services/CategoryService";
import { signDeviceToken } from "../../app/services/deviceToken";
import { User } from "../../domain/entities/User";
import {
  IRefreshSessionRepository,
  RefreshSession,
  SessionSummary,
} from "../../domain/repositories/refreshSession/IRefreshSessionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { AccountDeletedError, ApiError } from "../../shared/errors";
import { mockUserRepo } from "./userRepoMock";

jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    JWT_SECRET: "test-secret-key",
    JWT_EXPIRATION: "24h",
    REFRESH_TOKEN_EXPIRATION: "30d",
    BCRYPT_SALT_ROUNDS: 12,
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
  DB_TYPES: { MONGO: "MONGO" },
  ACCOUNT_TYPES: {},
  TYPES_OUTSIDE_SPENDING: ["ADJUSTMENT", "SETTLEMENT"],
  TYPES_RECORDED_ELSEWHERE: ["SETTLEMENT"],
  SETTLEMENT_PARTIES: { CONTACT: "CONTACT", GUESTS: "GUESTS" },
  GROUP_STATUSES: { OPEN: "OPEN", SETTLED: "SETTLED" },
  SHARED_HISTORY_REASONS: {
    SPLIT: "SPLIT",
    SPLIT_EDITED: "SPLIT_EDITED",
    AMOUNT_CHANGED: "AMOUNT_CHANGED",
    UNSPLIT: "UNSPLIT",
    PAYMENT: "PAYMENT",
    REIMPUTED: "REIMPUTED",
  },
}));

jest.mock("../../shared/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const createMockCategoryService = (): jest.Mocked<
  Pick<CategoryService, "seedDefaultCategories">
> => ({
  seedDefaultCategories: jest.fn().mockResolvedValue([]),
});

const createMockSessionRepo = (): jest.Mocked<IRefreshSessionRepository> => ({
  create: jest.fn().mockResolvedValue(undefined),
  findById: jest.fn().mockResolvedValue(null),
  rotate: jest.fn().mockResolvedValue(null),
  countReissue: jest.fn().mockResolvedValue(null),
  revokeFamily: jest.fn().mockResolvedValue(undefined),
  revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  listActiveByUser: jest.fn().mockResolvedValue([]),
  revokeFamilyForUser: jest.fn().mockResolvedValue(true),
});

describe("AuthService", () => {
  let service: AuthService;
  let repo: jest.Mocked<IUserRepository>;
  let categoryService: jest.Mocked<
    Pick<CategoryService, "seedDefaultCategories">
  >;
  let sessions: jest.Mocked<IRefreshSessionRepository>;
  let email: { sendNotice: jest.Mock };

  beforeEach(() => {
    repo = mockUserRepo();
    categoryService = createMockCategoryService();
    sessions = createMockSessionRepo();
    email = {
      sendNotice: jest.fn().mockResolvedValue({
        status: "sent",
        provider: "mailpit",
        messageId: "m",
      }),
    };
    service = new AuthService(
      repo,
      categoryService as unknown as CategoryService,
      sessions,
      email,
    );
  });

  describe("recognizedDevice [T-176]", () => {
    const owner = (tokenVersion: number) =>
      new User({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        name: "Owner",
        email: "owner@example.com",
        password: "hash",
        tokenVersion,
      });

    it("recognizes the device a login answered while the token version holds", async () => {
      repo.getReachableByEmail.mockResolvedValueOnce(
        new User({ ...owner(2), password: bcryptjs.hashSync("pw", 4) }),
      );
      const { deviceToken } = await service.login("owner@example.com", "pw");
      repo.getByEmail.mockResolvedValue(owner(2));
      await expect(
        service.recognizedDevice(deviceToken, "owner@example.com"),
      ).resolves.toEqual(expect.any(String));
    });

    it("stops recognizing it after a password change or a logout-all", async () => {
      repo.getReachableByEmail.mockResolvedValueOnce(
        new User({ ...owner(2), password: bcryptjs.hashSync("pw", 4) }),
      );
      const { deviceToken } = await service.login("owner@example.com", "pw");
      repo.getByEmail.mockResolvedValue(owner(3));
      await expect(
        service.recognizedDevice(deviceToken, "owner@example.com"),
      ).resolves.toBeNull();
    });

    it("does not recognize a device of an account that is gone", async () => {
      repo.getReachableByEmail.mockResolvedValueOnce(
        new User({ ...owner(0), password: bcryptjs.hashSync("pw", 4) }),
      );
      const { deviceToken } = await service.login("owner@example.com", "pw");
      repo.getByEmail.mockResolvedValue(null);
      await expect(
        service.recognizedDevice(deviceToken, "owner@example.com"),
      ).resolves.toBeNull();
    });

    it("does not look the user up for a token it cannot read", async () => {
      await expect(
        service.recognizedDevice("garbage", "owner@example.com"),
      ).resolves.toBeNull();
      expect(repo.getByEmail).not.toHaveBeenCalled();
    });
  });

  describe("register", () => {
    it("lets any other create failure through untouched", async () => {
      const failure = new Error("connection reset");
      repo.create.mockRejectedValue(failure);

      await expect(
        service.register({
          name: "John",
          email: "john@example.com",
          password: "newpassword123",
        }),
      ).rejects.toBe(failure);
    });

    it("answers EMAIL_TAKEN for an address kept for another account's undo link [T-211]", async () => {
      repo.create.mockRejectedValue(
        Object.assign(new Error("E11000 duplicate key"), {
          code: 11000,
          keyPattern: { heldEmails: 1 },
        }),
      );

      await expect(
        service.register({
          name: "John",
          email: "john@example.com",
          password: "newpassword123",
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "EMAIL_TAKEN" });
    });

    it("answers EMAIL_TAKEN for the email of a live account [T-153]", async () => {
      repo.create.mockRejectedValue(
        Object.assign(new Error("E11000 duplicate key"), {
          name: "MongoServerError",
          code: 11000,
          keyPattern: { email: 1 },
          keyValue: { email: "john@example.com" },
        }),
      );

      await expect(
        service.register({
          name: "John",
          email: "john@example.com",
          password: "newpassword123",
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "EMAIL_TAKEN" });
      expect(categoryService.seedDefaultCategories).not.toHaveBeenCalled();
    });

    it("should hash the password and create a user", async () => {
      const input = {
        name: "John",
        email: "john@example.com",
        password: "password123",
      };
      const createdUser = new User({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "John",
        email: "john@example.com",
        password: "hashed",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.create.mockResolvedValue(createdUser);

      const result = await service.register(input);

      expect(repo.create).toHaveBeenCalledTimes(1);
      const createArg = repo.create.mock.calls[0][0];
      expect(createArg.password).not.toBe("password123");
      expect(await bcryptjs.compare("password123", createArg.password!)).toBe(
        true,
      );
      expect(result.user).not.toHaveProperty("password");
      expect(result.user.name).toBe("John");
      expect(typeof result.accessToken).toBe("string");
      expect(typeof result.refreshToken).toBe("string");
    });

    it("should seed default categories for the new user", async () => {
      const input = {
        name: "John",
        email: "john@example.com",
        password: "password123",
      };
      const createdUser = new User({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "John",
        email: "john@example.com",
        password: "hashed",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.create.mockResolvedValue(createdUser);

      await service.register(input);

      expect(categoryService.seedDefaultCategories).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
    });

    it("should still register user when category seeding fails", async () => {
      const input = {
        name: "John",
        email: "john@example.com",
        password: "password123",
      };
      const createdUser = new User({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "John",
        email: "john@example.com",
        password: "hashed",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.create.mockResolvedValue(createdUser);
      categoryService.seedDefaultCategories.mockRejectedValue(
        new Error("DB write failed"),
      );

      const result = await service.register(input);

      expect(result.user.name).toBe("John");
      expect(result.user).not.toHaveProperty("password");
    });
  });

  describe("login", () => {
    const hashedPassword = bcryptjs.hashSync("password123", 12);
    const existingUser = new User({
      id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      name: "John",
      email: "john@example.com",
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it("should return access + refresh tokens and user on valid login", async () => {
      repo.getReachableByEmail.mockResolvedValue(existingUser);

      const result = await service.login("john@example.com", "password123");

      expect(repo.getReachableByEmail).toHaveBeenCalledWith(
        "john@example.com",
        expect.any(Date),
      );
      expect(typeof result.accessToken).toBe("string");
      expect(typeof result.refreshToken).toBe("string");

      const decoded = jwt.verify(result.accessToken, "test-secret-key") as {
        userId: string;
        email: string;
        sid: string;
      };
      expect(decoded.userId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac70");
      expect(decoded.email).toBe("john@example.com");
      // W-30: the access token names its own session family.
      const opened = sessions.create.mock.calls[0][0];
      expect(decoded.sid).toBe(opened.familyId);
      expect(opened.familyId).toBe(opened.jti);

      const refresh = jwt.verify(result.refreshToken, "test-secret-key") as {
        userId: string;
        type: string;
      };
      expect(refresh.type).toBe("refresh");
      expect(result.user).not.toHaveProperty("password");
      expect(result.user).not.toHaveProperty("tokenVersion");
    });

    it("should throw Unauthorized when email is not found", async () => {
      repo.getReachableByEmail.mockResolvedValue(null);

      await expect(
        service.login("unknown@example.com", "password123"),
      ).rejects.toThrow(ApiError);
      await expect(
        service.login("unknown@example.com", "password123"),
      ).rejects.toThrow("Invalid email or password");
    });

    it("should throw Unauthorized when password is wrong", async () => {
      repo.getReachableByEmail.mockResolvedValue(existingUser);

      await expect(
        service.login("john@example.com", "wrongpassword"),
      ).rejects.toThrow(ApiError);
      await expect(
        service.login("john@example.com", "wrongpassword"),
      ).rejects.toThrow("Invalid email or password");
    });
  });

  describe("new-sign-in [T-211]", () => {
    const EMAIL = "owner@example.com";
    const owner = (overrides: Partial<User> = {}) =>
      new User({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
        name: "Owner",
        email: EMAIL,
        password: bcryptjs.hashSync("pw", 4),
        locale: "es",
        timezone: "America/Bogota",
        emailVerifiedAt: new Date("2026-09-01T00:00:00.000Z"),
        tokenVersion: 2,
        ...overrides,
      });

    it("tells a confirmed account about a sign-in from a device without its token", async () => {
      repo.getReachableByEmail.mockResolvedValue(owner());

      await service.login(EMAIL, "pw", "Mozilla/5.0");

      expect(email.sendNotice).toHaveBeenCalledWith({
        template: "new-sign-in",
        data: { at: expect.any(Date), userAgent: "Mozilla/5.0" },
        recipient: {
          userId: owner().id,
          email: EMAIL,
          locale: "es",
          timezone: "America/Bogota",
        },
      });
    });

    it("says nothing to a device this email signed in before, even after a password change bumped tokenVersion", async () => {
      repo.getReachableByEmail.mockResolvedValue(owner());
      const { deviceToken } = await service.login(EMAIL, "pw");
      email.sendNotice.mockClear();
      repo.getReachableByEmail.mockResolvedValue(owner({ tokenVersion: 5 }));

      await service.login(EMAIL, "pw", undefined, deviceToken);

      expect(email.sendNotice).not.toHaveBeenCalled();
    });

    it("forgets the devices from before a reset or an undo", async () => {
      const deviceToken = signDeviceToken(EMAIL, 2);
      repo.getReachableByEmail.mockResolvedValue(
        owner({ devicesResetAt: new Date(Date.now() + 2000) }),
      );

      await service.login(EMAIL, "pw", undefined, deviceToken);

      expect(email.sendNotice).toHaveBeenCalledTimes(1);
    });

    it("knows a device whose token was issued after the last forget, to the millisecond", () => {
      const deviceToken = signDeviceToken(EMAIL, 3);
      const { issuedAtMs } = jwt.decode(deviceToken) as { issuedAtMs: number };

      expect(
        service.knownDevice(
          deviceToken,
          owner({ devicesResetAt: new Date(issuedAtMs) }),
        ),
      ).toBe(true);
      expect(
        service.knownDevice(
          deviceToken,
          owner({ devicesResetAt: new Date(issuedAtMs + 1) }),
        ),
      ).toBe(false);
    });

    it("reads a token from before T-211, which has only its second", () => {
      const legacy = jwt.sign(
        { tokenVersion: 2, jti: "d-1" },
        "test-secret-key",
        {
          algorithm: "HS256",
          audience: "device",
          subject: jwt.decode(signDeviceToken(EMAIL, 2))?.sub as string,
          expiresIn: "365d",
        },
      );
      const { iat } = jwt.decode(legacy) as { iat: number };

      expect(
        service.knownDevice(
          legacy,
          owner({ devicesResetAt: new Date(iat * 1000) }),
        ),
      ).toBe(true);
      expect(
        service.knownDevice(
          legacy,
          owner({ devicesResetAt: new Date(iat * 1000 + 1) }),
        ),
      ).toBe(false);
    });

    it("tells about the other devices after a move: their tokens name the old email", async () => {
      repo.getReachableByEmail.mockResolvedValue(
        owner({ email: "moved@example.com" }),
      );

      await service.login(
        "moved@example.com",
        "pw",
        undefined,
        signDeviceToken(EMAIL, 2),
      );

      expect(email.sendNotice).toHaveBeenCalledTimes(1);
    });

    it("does not take another email's device token for this account's", async () => {
      repo.getReachableByEmail.mockResolvedValue(owner());

      await service.login(
        EMAIL,
        "pw",
        undefined,
        signDeviceToken("someone@example.com", 2),
      );

      expect(email.sendNotice).toHaveBeenCalledTimes(1);
    });

    it("tells an address that was never confirmed nothing: it may be a stranger's", async () => {
      repo.getReachableByEmail.mockResolvedValue(
        owner({ emailVerifiedAt: null }),
      );

      await service.login(EMAIL, "pw");

      expect(email.sendNotice).not.toHaveBeenCalled();
    });

    it("signs in all the same when the notice cannot be sent", async () => {
      repo.getReachableByEmail.mockResolvedValue(owner());
      email.sendNotice.mockRejectedValue(new Error("render bug"));

      await expect(service.login(EMAIL, "pw")).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });

    it("sends nothing for a failed sign-in", async () => {
      repo.getReachableByEmail.mockResolvedValue(owner());

      await expect(service.login(EMAIL, "wrong")).rejects.toThrow(ApiError);
      expect(email.sendNotice).not.toHaveBeenCalled();
    });
  });

  describe("a deleted account [T-238]", () => {
    const NOW = new Date("2026-09-28T15:00:00Z");
    const deletedAt = new Date("2026-09-20T03:00:00Z");
    const keptUntil = new Date("2026-10-21T05:00:00Z");
    const deleted = (extra: Partial<User> = {}): User =>
      new User({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac90",
        name: "Ana",
        email: "ana@example.com",
        password: bcryptjs.hashSync("pw", 4),
        timezone: "America/Bogota",
        emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
        deletedAt,
        keptUntil,
        ...extra,
      });
    let clocked: AuthService;

    beforeEach(() => {
      clocked = new AuthService(
        repo,
        categoryService as unknown as CategoryService,
        sessions,
        email,
        () => NOW,
      );
    });

    it("answers its right password with its two days, and opens nothing", async () => {
      repo.getReachableByEmail.mockResolvedValue(deleted());

      const failure = await clocked
        .login("ana@example.com", "pw")
        .catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(AccountDeletedError);
      expect(failure).toMatchObject({
        statusCode: 409,
        code: "ACCOUNT_DELETED",
        deletedAccount: { deletedOn: "2026-09-19", keptUntil: "2026-10-20" },
      });
      expect(sessions.create).not.toHaveBeenCalled();
      expect(email.sendNotice).not.toHaveBeenCalled();
    });

    it("answers a wrong password the same as for any address", async () => {
      repo.getReachableByEmail.mockResolvedValue(deleted());

      await expect(
        clocked.login("ana@example.com", "wrong"),
      ).rejects.toMatchObject({ statusCode: 401, code: undefined });
    });

    it("gives an account deleted before T-238 its 30 days from now", async () => {
      repo.getReachableByEmail.mockResolvedValue(deleted({ keptUntil: null }));

      await expect(
        clocked.login("ana@example.com", "pw"),
      ).rejects.toMatchObject({
        deletedAccount: { deletedOn: "2026-09-19", keptUntil: "2026-10-28" },
      });
      expect(repo.setKeptUntil).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac90",
        new Date("2026-10-29T05:00:00Z"),
      );
    });

    it("restores it with the same password, signs in and tells the inbox", async () => {
      repo.getReachableByEmail.mockResolvedValue(deleted());
      repo.restoreDeleted.mockResolvedValue(
        deleted({ deletedAt: null, keptUntil: null }),
      );

      const result = await clocked.restore(
        "ana@example.com",
        "pw",
        "Mozilla/5.0",
      );

      expect(repo.restoreDeleted).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac90",
        NOW,
      );
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.deviceToken).toEqual(expect.any(String));
      expect(email.sendNotice).toHaveBeenCalledTimes(1);
      expect(email.sendNotice).toHaveBeenCalledWith(
        expect.objectContaining({
          template: "account-restored",
          data: {
            at: NOW,
            userAgent: "Mozilla/5.0",
            deletedOn: "2026-09-19",
            by: "sign-in",
          },
        }),
      );
    });

    it("signs a live account in like a login, with nothing to restore", async () => {
      repo.getReachableByEmail.mockResolvedValue(
        deleted({ deletedAt: null, keptUntil: null }),
      );

      await expect(clocked.restore("ana@example.com", "pw")).resolves.toEqual(
        expect.objectContaining({ accessToken: expect.any(String) }),
      );
      expect(repo.restoreDeleted).not.toHaveBeenCalled();
    });

    it("refuses when the account stopped being kept meanwhile", async () => {
      repo.getReachableByEmail.mockResolvedValue(deleted());
      repo.restoreDeleted.mockResolvedValue(null);

      await expect(
        clocked.restore("ana@example.com", "pw"),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(sessions.create).not.toHaveBeenCalled();
    });
  });

  describe("the confirmation deadline in the access token [T-238]", () => {
    const endsAt = new Date("2026-10-13T05:00:00Z");
    const signedIn = async (user: User): Promise<Record<string, unknown>> => {
      repo.getReachableByEmail.mockResolvedValue(user);
      const { accessToken } = await service.login("old@example.com", "pw");
      return jwt.decode(accessToken) as Record<string, unknown>;
    };
    const old = (extra: Partial<User>): User =>
      new User({
        name: "Old",
        email: "old@example.com",
        password: bcryptjs.hashSync("pw", 4),
        confirmDeadline: {
          day: "2026-10-12",
          endsAt,
          remindedAt: null,
          links: [],
        },
        ...extra,
      });

    it("carries the end of an unconfirmed account's deadline", async () => {
      await expect(signedIn(old({}))).resolves.toMatchObject({
        confirmBy: endsAt.getTime(),
      });
    });

    it("carries nothing once the account is confirmed", async () => {
      const claims = await signedIn(old({ emailVerifiedAt: new Date() }));
      expect(claims).not.toHaveProperty("confirmBy");
    });
  });

  describe("createAccount [T-238]", () => {
    it("stores the hash it is given and seeds the categories", async () => {
      repo.create.mockImplementation(async (user) => new User(user as User));

      const created = await service.createAccount({
        name: "Ana",
        email: "ana@example.com",
        passwordHash: "$2b$04$hash",
        emailVerifiedAt: new Date("2026-09-28T00:00:00Z"),
      });

      expect(repo.create.mock.calls[0][0]).toMatchObject({
        password: "$2b$04$hash",
        emailVerifiedAt: new Date("2026-09-28T00:00:00Z"),
      });
      expect(categoryService.seedDefaultCategories).toHaveBeenCalledWith(
        created.id,
      );
    });

    it("answers EMAIL_TAKEN when another account holds the address, a deleted one included", async () => {
      repo.create.mockRejectedValue(
        Object.assign(new Error("E11000 duplicate key"), {
          code: 11000,
          keyPattern: { email: 1 },
        }),
      );

      await expect(
        service.createAccount({
          name: "Ana",
          email: "ana@example.com",
          passwordHash: "$2b$04$hash",
          emailVerifiedAt: null,
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "EMAIL_TAKEN" });
      expect(categoryService.seedDefaultCategories).not.toHaveBeenCalled();
    });
  });

  describe("isLiveSessionOf [T-221]", () => {
    const user = new User({
      id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      name: "John",
      email: "john@example.com",
      password: "hash",
      tokenVersion: 2,
    });
    const sign = (
      claims: Record<string, unknown> = {},
      secret = "test-secret-key",
    ): string =>
      jwt.sign(
        {
          userId: user.id,
          tokenVersion: 2,
          type: "refresh",
          jti: "jti-1",
          ...claims,
        },
        secret,
        { algorithm: "HS256", expiresIn: "30d" },
      );
    const row = (overrides: Partial<RefreshSession> = {}): RefreshSession => ({
      jti: "jti-1",
      userId: user.id,
      familyId: "fam-1",
      expiresAt: new Date(Date.now() + 86_400_000),
      replacedBy: null,
      revokedAt: null,
      lastUsedAt: null,
      reissueCount: 0,
      reissuedAt: null,
      ...overrides,
    });

    it("is true for a session of the account that nothing revoked, and rotates nothing", async () => {
      sessions.findById.mockResolvedValue(row());

      await expect(service.isLiveSessionOf(sign(), user)).resolves.toBe(true);
      expect(sessions.findById).toHaveBeenCalledWith("jti-1");
      expect(sessions.rotate).not.toHaveBeenCalled();
    });

    it.each([
      ["a token that does not verify", () => sign({}, "another-secret"), row()],
      ["a token that is not a refresh", () => sign({ type: "access" }), row()],
      [
        "another account's session",
        () => sign({ userId: "someone-else" }),
        row(),
      ],
      [
        "a token from before the last tokenVersion",
        () => sign({ tokenVersion: 1 }),
        row(),
      ],
      ["a revoked session", () => sign(), row({ revokedAt: new Date() })],
      [
        "a token already rotated away",
        () => sign(),
        row({ replacedBy: "jti-2", lastUsedAt: new Date() }),
      ],
      [
        "an expired session",
        () => sign(),
        row({ expiresAt: new Date(Date.now() - 1) }),
      ],
      [
        "a session row of someone else",
        () => sign(),
        row({ userId: "someone-else" }),
      ],
      ["a session with no row", () => sign(), null],
    ] as [string, () => string, RefreshSession | null][])(
      "is false for %s",
      async (_label, token, found) => {
        sessions.findById.mockResolvedValue(found);

        await expect(service.isLiveSessionOf(token(), user)).resolves.toBe(
          false,
        );
      },
    );
  });

  describe("refresh [M3]", () => {
    const user = new User({
      id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      name: "John",
      email: "john@example.com",
      password: "hash",
      tokenVersion: 2,
    });

    const signRefresh = (tokenVersion: number, jti = "jti-1") =>
      jwt.sign(
        { userId: user.id, tokenVersion, type: "refresh", jti },
        "test-secret-key",
        { algorithm: "HS256", expiresIn: "30d" },
      );

    // The gap measured in production on 2026-09-11 between a lost rotation and the client's return.
    const PRODUCTION_GAP_MS = 13_284_000;

    const activeSession = () => ({
      jti: "jti-1",
      userId: user.id,
      familyId: "fam-1",
      expiresAt: new Date(Date.now() + 86_400_000),
      replacedBy: null,
      revokedAt: null,
      lastUsedAt: null,
      reissueCount: 0,
      reissuedAt: null,
    });

    // What a rotation leaves: the presented row points at its successor, the family's live tip.
    const rotatedSession = (
      overrides: Partial<RefreshSession> = {},
    ): RefreshSession => ({
      ...activeSession(),
      replacedBy: "jti-2",
      lastUsedAt: new Date(),
      ...overrides,
    });

    const successorSession = (
      overrides: Partial<RefreshSession> = {},
    ): RefreshSession => ({
      ...activeSession(),
      jti: "jti-2",
      ...overrides,
    });

    const chainIs = (rows: RefreshSession[]): void => {
      sessions.findById.mockImplementation(
        async (id: string) => rows.find((row) => row.jti === id) ?? null,
      );
      sessions.countReissue.mockImplementation(async (id: string) => {
        const row = rows.find((candidate) => candidate.jti === id);
        if (!row?.replacedBy || row.revokedAt) return null;
        row.reissueCount += 1;
        return { ...row, reissuedAt: new Date() };
      });
    };

    it("issues a new token pair and rotates the session [R2-08]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(activeSession());
      sessions.findById.mockResolvedValue(rotatedSession());

      const result = await service.refresh(signRefresh(2));

      expect(typeof result.accessToken).toBe("string");
      expect(typeof result.refreshToken).toBe("string");
      // The new session joins the same family with the same absolute expiry.
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: "fam-1", userId: user.id }),
      );
      const rotated = jwt.verify(result.refreshToken, "test-secret-key") as {
        jti: string;
      };
      expect(rotated.jti).not.toBe("jti-1");
      // The renewed access token still points at the same family.
      const access = jwt.verify(result.accessToken, "test-secret-key") as {
        sid: string;
      };
      expect(access.sid).toBe("fam-1");
    });

    it("closes the session when a logout lands mid-rotation [H-62]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(activeSession());
      let logoutLanded = false;
      sessions.create.mockImplementation(async () => {
        logoutLanded = true;
      });
      sessions.findById.mockImplementation(async () =>
        logoutLanded ? { ...activeSession(), revokedAt: new Date() } : null,
      );

      await expect(service.refresh(signRefresh(2))).rejects.toThrow("revoked");
      expect(sessions.revokeFamily).toHaveBeenCalledWith("fam-1");
    });

    it("closes a family whose absolute expiry has passed [H-62]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue({
        ...activeSession(),
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh(signRefresh(2))).rejects.toThrow("expired");
      // Left alive, the rotated row would read as theft the next time it was presented.
      expect(sessions.revokeFamily).toHaveBeenCalledWith("fam-1");
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it("closes the session when the rotated row is gone [H-62]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(activeSession());
      sessions.findById.mockResolvedValue(null);

      await expect(service.refresh(signRefresh(2))).rejects.toThrow("revoked");
      expect(sessions.revokeFamily).toHaveBeenCalledWith("fam-1");
    });

    it("revokes the whole family when a rotated token is reused [R2-08]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      sessions.findById.mockResolvedValue({
        ...activeSession(),
        replacedBy: "jti-2",
      });

      await expect(service.refresh(signRefresh(2))).rejects.toThrow("revoked");
      expect(sessions.revokeFamily).toHaveBeenCalledWith("fam-1");
    });

    it("re-issues the pair whose answer never reached the client [H-37]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      chainIs([rotatedSession(), successorSession()]);

      const result = await service.refresh(signRefresh(2));

      // The successor is handed over as it is: no new row, no new rotation.
      const reissued = jwt.verify(result.refreshToken, "test-secret-key") as {
        jti: string;
      };
      expect(reissued.jti).toBe("jti-2");
      const access = jwt.verify(result.accessToken, "test-secret-key") as {
        sid: string;
      };
      expect(access.sid).toBe("fam-1");
      expect(sessions.create).not.toHaveBeenCalled();
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
    });

    it("revokes the family when the successor was already used [H-37]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      chainIs([
        rotatedSession(),
        successorSession({ replacedBy: "jti-3", lastUsedAt: new Date() }),
      ]);

      await expect(service.refresh(signRefresh(2))).rejects.toThrow("revoked");
      expect(sessions.revokeFamily).toHaveBeenCalledWith("fam-1");
    });

    it("revokes the family when the successor is revoked [H-37]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      chainIs([rotatedSession(), successorSession({ revokedAt: new Date() })]);

      await expect(service.refresh(signRefresh(2))).rejects.toThrow("revoked");
      expect(sessions.revokeFamily).toHaveBeenCalledWith("fam-1");
    });

    it("re-issues however old the rotation is, while the successor is untouched [T-33]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      chainIs([
        rotatedSession({
          lastUsedAt: new Date(Date.now() - PRODUCTION_GAP_MS),
        }),
        successorSession(),
      ]);

      const result = await service.refresh(signRefresh(2));

      const reissued = jwt.verify(result.refreshToken, "test-secret-key") as {
        jti: string;
      };
      expect(reissued.jti).toBe("jti-2");
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
    });

    it("answers the same successor as many times as the answer is lost [T-33]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      chainIs([rotatedSession(), successorSession()]);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await service.refresh(signRefresh(2));
        const reissued = jwt.verify(result.refreshToken, "test-secret-key") as {
          jti: string;
        };
        expect(reissued.jti).toBe("jti-2");
      }
      expect(sessions.create).not.toHaveBeenCalled();
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
    });

    it("still re-issues on the last one of the budget [T-33]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      chainIs([rotatedSession({ reissueCount: 9 }), successorSession()]);

      const result = await service.refresh(signRefresh(2));

      const reissued = jwt.verify(result.refreshToken, "test-secret-key") as {
        jti: string;
      };
      expect(reissued.jti).toBe("jti-2");
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
    });

    it("retires the row, not the family, once the budget is spent [T-33]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      chainIs([rotatedSession({ reissueCount: 10 }), successorSession()]);

      await expect(service.refresh(signRefresh(2))).rejects.toThrow("revoked");
      // The successor is still untouched, so the live client keeps its family.
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
    });

    it("does not cry theft when the family was revoked on purpose [T-33]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      chainIs([
        rotatedSession({ revokedAt: new Date() }),
        successorSession({ revokedAt: new Date() }),
      ]);

      await expect(service.refresh(signRefresh(2))).rejects.toThrow("revoked");
      // A logout already ended it: revoking again would be a second write and a false alarm.
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
      expect(sessions.countReissue).not.toHaveBeenCalled();
    });

    it("revokes the family when the successor is gone [H-37]", async () => {
      repo.getById.mockResolvedValue(user);
      sessions.rotate.mockResolvedValue(null);
      chainIs([rotatedSession()]);

      await expect(service.refresh(signRefresh(2))).rejects.toThrow("revoked");
      expect(sessions.revokeFamily).toHaveBeenCalledWith("fam-1");
    });

    it("rejects a refresh token without jti (pre-session token)", async () => {
      repo.getById.mockResolvedValue(user);
      const legacy = jwt.sign(
        { userId: user.id, tokenVersion: 2, type: "refresh" },
        "test-secret-key",
        { algorithm: "HS256", expiresIn: "30d" },
      );

      await expect(service.refresh(legacy)).rejects.toThrow(
        "Invalid refresh token",
      );
    });

    it("rejects a refresh token whose tokenVersion is stale (revoked)", async () => {
      repo.getById.mockResolvedValue(user); // current tokenVersion = 2

      await expect(service.refresh(signRefresh(1))).rejects.toThrow("revoked");
    });

    it("rejects an access token used as a refresh token", async () => {
      const accessToken = jwt.sign(
        { userId: user.id, email: user.email },
        "test-secret-key",
        { algorithm: "HS256", expiresIn: "15m" },
      );

      await expect(service.refresh(accessToken)).rejects.toThrow(
        "Invalid refresh token",
      );
    });

    it("rejects a garbage/expired token", async () => {
      await expect(service.refresh("not-a-jwt")).rejects.toThrow(
        "Invalid or expired refresh token",
      );
    });
  });

  describe("logout [R2-08]", () => {
    const user = new User({
      id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      name: "John",
      email: "john@example.com",
      password: "hash",
      tokenVersion: 2,
    });

    it("revokes the token's session family", async () => {
      const token = jwt.sign(
        { userId: user.id, tokenVersion: 2, type: "refresh", jti: "jti-1" },
        "test-secret-key",
        { algorithm: "HS256", expiresIn: "30d" },
      );
      sessions.findById.mockResolvedValue({
        jti: "jti-1",
        userId: user.id,
        familyId: "fam-1",
        expiresAt: new Date(Date.now() + 1000),
        replacedBy: null,
        revokedAt: null,
        lastUsedAt: null,
        reissueCount: 0,
        reissuedAt: null,
      });

      await service.logout(token);

      expect(sessions.revokeFamily).toHaveBeenCalledWith("fam-1");
    });

    it("logoutAll bumps tokenVersion and revokes every session", async () => {
      await service.logoutAll(user.id);

      expect(repo.forgetDevices).toHaveBeenCalledWith(
        user.id,
        expect.any(Date),
      );
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(user.id);
    });

    it("logoutAll forgets every device and answers this one a token issued after it [T-211]", async () => {
      const bumped = new User({
        ...user,
        tokenVersion: 4,
        devicesResetAt: new Date(),
      });
      repo.forgetDevices.mockResolvedValue(bumped);

      const { deviceToken } = await service.logoutAll(user.id);

      expect(deviceToken).toEqual(expect.any(String));
      expect(service.knownDevice(deviceToken, bumped)).toBe(true);
      const before = signDeviceToken(bumped.email, 3);
      const later = new User({
        ...bumped,
        devicesResetAt: new Date(Date.now() + 1),
      });
      expect(service.knownDevice(before, later)).toBe(false);
    });
  });

  describe("sessions [R2-21]", () => {
    it("lists the user's active sessions", async () => {
      const summary = {
        id: "fam-1",
        createdAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        userAgent: "test-agent",
      };
      sessions.listActiveByUser.mockResolvedValue([summary]);

      const result = await service.listSessions("user-1");

      expect(result).toEqual([{ ...summary, current: false }]);
      expect(sessions.listActiveByUser).toHaveBeenCalledWith("user-1");
    });

    it("marks the caller's own family as current [W-30]", async () => {
      const row = (id: string): SessionSummary => ({
        id,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      });
      sessions.listActiveByUser.mockResolvedValue([row("fam-1"), row("fam-2")]);

      const result = await service.listSessions("user-1", "fam-2");

      expect(result.map((s) => [s.id, s.current])).toEqual([
        ["fam-1", false],
        ["fam-2", true],
      ]);
    });

    it("marks nothing current for a token without sid or for a revoked family", async () => {
      const row = {
        id: "fam-1",
        createdAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      };
      sessions.listActiveByUser.mockResolvedValue([row]);

      expect(await service.listSessions("user-1", undefined)).toEqual([
        { ...row, current: false },
      ]);
      expect(await service.listSessions("user-1", "fam-gone")).toEqual([
        { ...row, current: false },
      ]);
    });

    it("revokes an owned session and 404s a foreign one", async () => {
      sessions.revokeFamilyForUser.mockResolvedValue(true);
      await expect(
        service.revokeSession("user-1", "fam-1"),
      ).resolves.toBeUndefined();
      expect(sessions.revokeFamilyForUser).toHaveBeenCalledWith(
        "user-1",
        "fam-1",
      );

      sessions.revokeFamilyForUser.mockResolvedValue(false);
      await expect(service.revokeSession("user-1", "fam-2")).rejects.toThrow(
        "Session not found",
      );
    });
  });
});
