jest.mock("../../shared/constants", () => ({
  ENVIRONMENT: {
    PORT: 3000,
    DB_TYPE: "SEQ",
    JWT_SECRET: "test",
    BCRYPT_SALT_ROUNDS: 12,
    JWT_EXPIRATION: "24h",
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  },
}));

import bcryptjs from "bcryptjs";

import { UpdateUserDTO } from "../../app/dtos/UserDTO";
import { UserService } from "../../app/services/UserService";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../shared/errors";

const testUserId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";

const mockUser: User = new User({
  id: testUserId,
  name: "John Doe",
  email: "john@example.com",
  password: "hashedpassword",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

const createMockRepo = (): jest.Mocked<IUserRepository> => ({
  getAll: jest.fn(),
  getById: jest.fn(),
  getByEmail: jest.fn(),
  getDeletedByEmail: jest.fn().mockResolvedValue(null),
  getByIdWithPassword: jest.fn().mockResolvedValue(null),
  bumpTokenVersion: jest.fn().mockResolvedValue(undefined),
  recordLogin: jest.fn().mockResolvedValue(undefined),
  reactivate: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

describe("UserService", () => {
  let service: UserService;
  let repo: jest.Mocked<IUserRepository>;
  let accountRepo: jest.Mocked<IAccountRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    accountRepo = {
      countByUserId: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<IAccountRepository>;
    service = new UserService(repo, accountRepo);
  });

  describe("getUserById", () => {
    it("should return user when found and is own user", async () => {
      repo.getById.mockResolvedValue(mockUser);

      const result = await service.getUserById(testUserId, testUserId);

      expect(repo.getById).toHaveBeenCalledWith(testUserId);
      expect(result.name).toBe("John Doe");
    });

    it("should throw Forbidden when accessing another user", async () => {
      await expect(
        service.getUserById("019576a0-d7b6-7d6d-af6a-000000000000", testUserId),
      ).rejects.toThrow("User not found");
    });

    it("should throw NotFound when user does not exist", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(service.getUserById(testUserId, testUserId)).rejects.toThrow(
        "User not found",
      );
    });
  });

  describe("updateUser", () => {
    it("should update a user and strip password from response", async () => {
      const updatedUser = new User({
        ...mockUser,
        name: "Updated Name",
      });
      repo.update.mockResolvedValue(updatedUser);

      const result = await service.updateUser(
        testUserId,
        { name: "Updated Name" },
        testUserId,
      );

      expect(repo.update).toHaveBeenCalledWith(testUserId, {
        name: "Updated Name",
      });
      expect(result.name).toBe("Updated Name");
      expect((result as UpdateUserDTO).password).toBeUndefined();
    });

    it("should throw Forbidden when updating another user", async () => {
      await expect(
        service.updateUser(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          {
            name: "Test",
          },
          testUserId,
        ),
      ).rejects.toThrow("User not found");
    });

    it("should throw when id in body does not match param id", async () => {
      await expect(
        service.updateUser(
          testUserId,
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
            name: "Test",
          },
          testUserId,
        ),
      ).rejects.toThrow(ApiError);
      await expect(
        service.updateUser(
          testUserId,
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
            name: "Test",
          },
          testUserId,
        ),
      ).rejects.toThrow("User id does not match");
    });

    it("should hash password and bump tokenVersion on password change", async () => {
      const withHash = new User({
        ...mockUser,
        password: bcryptjs.hashSync("oldpassword", 12),
      });
      repo.getByIdWithPassword.mockResolvedValue(withHash);
      repo.update.mockResolvedValue(mockUser);

      await service.updateUser(
        testUserId,
        {
          password: "newpassword",
          currentPassword: "oldpassword",
        },
        testUserId,
      );

      const updateArg = repo.update.mock.calls[0][1];
      expect(updateArg.password).not.toBe("newpassword");
      expect(await bcryptjs.compare("newpassword", updateArg.password!)).toBe(
        true,
      );
      // currentPassword is verification-only: never persisted.
      expect(updateArg).not.toHaveProperty("currentPassword");
      // tokenVersion is bumped so outstanding refresh tokens are revoked [M3]
      expect(updateArg.tokenVersion).toBe(mockUser.tokenVersion + 1);
    });

    it("rejects a credential change with a wrong currentPassword [R2-08]", async () => {
      const withHash = new User({
        ...mockUser,
        password: bcryptjs.hashSync("oldpassword", 12),
      });
      repo.getByIdWithPassword.mockResolvedValue(withHash);

      await expect(
        service.updateUser(
          testUserId,
          { email: "attacker@evil.com", currentPassword: "guess" },
          testUserId,
        ),
      ).rejects.toThrow("Current password is incorrect");
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteUser", () => {
    it("should delete the authenticated user", async () => {
      repo.getById.mockResolvedValue(mockUser);
      repo.delete.mockResolvedValue();

      await service.deleteUser(testUserId, testUserId);

      expect(repo.getById).toHaveBeenCalledWith(testUserId);
      expect(repo.delete).toHaveBeenCalledWith(testUserId);
    });

    it("should throw Forbidden when deleting another user", async () => {
      await expect(
        service.deleteUser("019576a0-d7b6-7d6d-af6a-000000000000", testUserId),
      ).rejects.toThrow("User not found");
    });

    it("should throw NotFound when user does not exist", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(service.deleteUser(testUserId, testUserId)).rejects.toThrow(
        "User not found",
      );
    });
  });

  describe("error propagation", () => {
    it("should propagate repository error on create (update) failure", async () => {
      repo.update.mockRejectedValue(new Error("DB write failed"));

      await expect(
        service.updateUser(testUserId, { name: "New" }, testUserId),
      ).rejects.toThrow("DB write failed");
    });

    it("should propagate repository error on delete failure", async () => {
      repo.getById.mockResolvedValue(mockUser);
      repo.delete.mockRejectedValue(new Error("DB delete failed"));

      await expect(service.deleteUser(testUserId, testUserId)).rejects.toThrow(
        "DB delete failed",
      );
    });
  });

  describe("currency [multi-moneda etapa 1]", () => {
    it("blocks changing the currency once accounts exist", async () => {
      repo.getById.mockResolvedValue(mockUser);
      accountRepo.countByUserId.mockResolvedValue(2);

      await expect(
        service.updateUser(testUserId, { currency: "USD" }, testUserId),
      ).rejects.toThrow("Currency cannot be changed");
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("allows changing the currency while there is no data", async () => {
      repo.getById.mockResolvedValue(mockUser);
      accountRepo.countByUserId.mockResolvedValue(0);
      repo.update.mockResolvedValue(mockUser);

      await expect(
        service.updateUser(testUserId, { currency: "USD" }, testUserId),
      ).resolves.toBeDefined();
    });
  });
});
