import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";

import { AuthService } from "../../app/services/AuthService";
import { CategoryService } from "../../app/services/CategoryService";
import { User } from "../../domain/entities/User";
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
  DB_TYPES: { SEQ: "SEQ" },
  ACCOUNT_TYPES: {},
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
  getAll: jest.fn(),
  getById: jest.fn(),
  getByEmail: jest.fn(),
  getDeletedByEmail: jest.fn().mockResolvedValue(null),
  reactivate: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

const createMockCategoryService = (): jest.Mocked<Pick<CategoryService, "seedDefaultCategories">> => ({
  seedDefaultCategories: jest.fn().mockResolvedValue([]),
});

describe("AuthService", () => {
  let service: AuthService;
  let repo: jest.Mocked<IUserRepository>;
  let categoryService: jest.Mocked<Pick<CategoryService, "seedDefaultCategories">>;

  beforeEach(() => {
    repo = createMockRepo();
    categoryService = createMockCategoryService();
    service = new AuthService(repo, categoryService as unknown as CategoryService);
  });

  describe("register", () => {
    it("reactivates a soft-deleted account instead of creating a new one [R2-09]", async () => {
      const deletedUser = new User({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Old Name",
        email: "john@example.com",
        password: "old-hash",
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
      expect(result.name).toBe("John");
      expect(result.reactivated).toBe(true);
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
      expect(result).not.toHaveProperty("password");
      expect(result.name).toBe("John");
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

      expect(result.name).toBe("John");
      expect(result).not.toHaveProperty("password");
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
      };
      expect(decoded.userId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac70");
      expect(decoded.email).toBe("john@example.com");

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

    const signRefresh = (tokenVersion: number) =>
      jwt.sign(
        { userId: user.id, tokenVersion, type: "refresh" },
        "test-secret-key",
        { algorithm: "HS256", expiresIn: "30d" },
      );

    it("issues a new token pair for a valid refresh token", async () => {
      repo.getById.mockResolvedValue(user);

      const result = await service.refresh(signRefresh(2));

      expect(typeof result.accessToken).toBe("string");
      expect(typeof result.refreshToken).toBe("string");
    });

    it("rejects a refresh token whose tokenVersion is stale (revoked)", async () => {
      repo.getById.mockResolvedValue(user); // current tokenVersion = 2

      await expect(service.refresh(signRefresh(1))).rejects.toThrow(
        "revoked",
      );
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
});
