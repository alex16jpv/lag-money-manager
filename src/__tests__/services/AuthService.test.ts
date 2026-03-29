import { AuthService } from "../../app/services/AuthService";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { User } from "../../domain/entities/User";
import { ApiError } from "../../shared/errors";
import { DomainValidationError } from "../../domain/errors";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";

jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    JWT_SECRET: "test-secret-key",
  },
  DB_TYPES: { SEQ: "SEQ" },
  ACCOUNT_TYPES: {},
}));

const createMockRepo = (): jest.Mocked<IUserRepository> => ({
  getAll: jest.fn(),
  getById: jest.fn(),
  getByEmail: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

describe("AuthService", () => {
  let service: AuthService;
  let repo: jest.Mocked<IUserRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new AuthService(repo);
  });

  describe("register", () => {
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

    it("should throw when validation fails (missing name)", async () => {
      const input = {
        name: "",
        email: "john@example.com",
        password: "password123",
      };

      await expect(service.register(input)).rejects.toThrow(
        DomainValidationError,
      );
      expect(repo.create).not.toHaveBeenCalled();
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

    it("should return a token and user on valid login", async () => {
      repo.getByEmail.mockResolvedValue(existingUser);

      const result = await service.login("john@example.com", "password123");

      expect(repo.getByEmail).toHaveBeenCalledWith("john@example.com");
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe("string");

      const decoded = jwt.verify(result.token, "test-secret-key") as {
        userId: string;
        email: string;
      };
      expect(decoded.userId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac70");
      expect(decoded.email).toBe("john@example.com");
      expect(result.user).not.toHaveProperty("password");
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
});
