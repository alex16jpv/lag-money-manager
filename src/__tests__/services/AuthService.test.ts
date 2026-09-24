import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";

import { AuthService } from "../../app/services/AuthService";
import { CategoryService } from "../../app/services/CategoryService";
import { User } from "../../domain/entities/User";
import {
  IRefreshSessionRepository,
  RefreshSession,
  SessionSummary,
} from "../../domain/repositories/refreshSession/IRefreshSessionRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../shared/errors";

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

const createMockRepo = (): jest.Mocked<IUserRepository> => ({
  getManyByIds: jest.fn().mockResolvedValue([]),
  getAll: jest.fn(),
  getById: jest.fn(),
  getByEmail: jest.fn(),
  getDeletedByEmail: jest.fn().mockResolvedValue(null),
  getByIdWithPassword: jest.fn().mockResolvedValue(null),
  bumpTokenVersion: jest.fn().mockResolvedValue(undefined),
  updateWithTokenBump: jest.fn(),
  recordLogin: jest.fn().mockResolvedValue(undefined),
  reactivate: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

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

  beforeEach(() => {
    repo = createMockRepo();
    categoryService = createMockCategoryService();
    sessions = createMockSessionRepo();
    service = new AuthService(
      repo,
      categoryService as unknown as CategoryService,
      sessions,
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
      repo.getByEmail.mockResolvedValueOnce(
        new User({ ...owner(2), password: bcryptjs.hashSync("pw", 4) }),
      );
      const { deviceToken } = await service.login("owner@example.com", "pw");
      repo.getByEmail.mockResolvedValue(owner(2));
      await expect(
        service.recognizedDevice(deviceToken, "owner@example.com"),
      ).resolves.toEqual(expect.any(String));
    });

    it("stops recognizing it after a password change or a logout-all", async () => {
      repo.getByEmail.mockResolvedValueOnce(
        new User({ ...owner(2), password: bcryptjs.hashSync("pw", 4) }),
      );
      const { deviceToken } = await service.login("owner@example.com", "pw");
      repo.getByEmail.mockResolvedValue(owner(3));
      await expect(
        service.recognizedDevice(deviceToken, "owner@example.com"),
      ).resolves.toBeNull();
    });

    it("does not recognize a device of an account that is gone", async () => {
      repo.getByEmail.mockResolvedValueOnce(
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
    it("reactivates a soft-deleted account with the password it had [R2-09, T-153]", async () => {
      const deletedUser = new User({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Old Name",
        email: "john@example.com",
        password: bcryptjs.hashSync("newpassword123", 4),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.getDeletedByEmail.mockResolvedValue(deletedUser);
      repo.reactivate.mockResolvedValue(
        new User({ ...deletedUser, name: "John" }),
      );

      const result = await service.register({
        name: "John",
        email: "john@example.com",
        password: "newpassword123",
      });

      expect(repo.reactivate).toHaveBeenCalledTimes(1);
      const [id, updates] = repo.reactivate.mock.calls[0];
      expect(id).toBe(deletedUser.id);
      expect(updates.name).toBe("John");
      expect(updates.password).not.toBe("newpassword123");
      expect(repo.create).not.toHaveBeenCalled();
      // Existing categories are kept: no re-seed on reactivation.
      expect(categoryService.seedDefaultCategories).not.toHaveBeenCalled();
      expect(result.user.name).toBe("John");
      expect(result.user.reactivated).toBe(true);
      // Register opens a session directly [R2-39].
      expect(typeof result.accessToken).toBe("string");
      expect(typeof result.refreshToken).toBe("string");
    });

    it("refuses to reactivate a soft-deleted account with any other password [T-153]", async () => {
      repo.getDeletedByEmail.mockResolvedValue(
        new User({
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          name: "Victim",
          email: "john@example.com",
          password: bcryptjs.hashSync("the-old-one", 4),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await expect(
        service.register({
          name: "Attacker",
          email: "john@example.com",
          password: "newpassword123",
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "EMAIL_TAKEN" });
      expect(repo.reactivate).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it("reactivates with the stored hash, so no second bcrypt runs [T-153]", async () => {
      const storedHash = bcryptjs.hashSync("newpassword123", 4);
      const deletedUser = new User({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Old Name",
        email: "john@example.com",
        password: storedHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      repo.getDeletedByEmail.mockResolvedValue(deletedUser);
      repo.reactivate.mockResolvedValue(deletedUser);
      const hash = jest.spyOn(bcryptjs, "hash");

      await service.register({
        name: "John",
        email: "john@example.com",
        password: "newpassword123",
      });

      expect(repo.reactivate.mock.calls[0][1].password).toBe(storedHash);
      expect(hash).not.toHaveBeenCalled();
      hash.mockRestore();
    });

    it("answers EMAIL_TAKEN when a concurrent register reactivated it first", async () => {
      repo.getDeletedByEmail.mockResolvedValue(
        new User({
          id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          name: "Ana",
          email: "john@example.com",
          password: bcryptjs.hashSync("newpassword123", 4),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
      repo.reactivate.mockRejectedValue(
        new ApiError("NotFound", "User not found"),
      );

      await expect(
        service.register({
          name: "John",
          email: "john@example.com",
          password: "newpassword123",
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: "EMAIL_TAKEN" });
    });

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
      repo.getByEmail.mockResolvedValue(existingUser);

      const result = await service.login("john@example.com", "password123");

      expect(repo.getByEmail).toHaveBeenCalledWith("john@example.com");
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
      repo.getByEmail.mockResolvedValue(null);

      await expect(
        service.login("unknown@example.com", "password123"),
      ).rejects.toThrow(ApiError);
      await expect(
        service.login("unknown@example.com", "password123"),
      ).rejects.toThrow("Invalid email or password");
    });

    it("should throw Unauthorized when password is wrong", async () => {
      repo.getByEmail.mockResolvedValue(existingUser);

      await expect(
        service.login("john@example.com", "wrongpassword"),
      ).rejects.toThrow(ApiError);
      await expect(
        service.login("john@example.com", "wrongpassword"),
      ).rejects.toThrow("Invalid email or password");
    });
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

      expect(repo.bumpTokenVersion).toHaveBeenCalledWith(user.id);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(user.id);
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
