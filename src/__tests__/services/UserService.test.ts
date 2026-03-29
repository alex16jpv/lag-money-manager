import { UserService } from "../../app/services/UserService";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { User } from "../../domain/entities/User";
import { ApiError } from "../../shared/errors";
import { DomainValidationError } from "../../domain/errors";
import bcryptjs from "bcryptjs";

const mockUser: User = new User({
  id: 1,
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
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

describe("UserService", () => {
  let service: UserService;
  let repo: jest.Mocked<IUserRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new UserService(repo);
  });

  describe("getAllUsers", () => {
    it("should return all users from the repository", async () => {
      repo.getAll.mockResolvedValue([mockUser]);

      const result = await service.getAllUsers();

      expect(repo.getAll).toHaveBeenCalledTimes(1);
      expect(result).toEqual([mockUser]);
    });

    it("should return empty array when no users exist", async () => {
      repo.getAll.mockResolvedValue([]);

      const result = await service.getAllUsers();

      expect(result).toEqual([]);
    });
  });

  describe("getUserById", () => {
    it("should return user when found", async () => {
      repo.getById.mockResolvedValue(mockUser);

      const result = await service.getUserById(1);

      expect(repo.getById).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockUser);
    });

    it("should throw NotFound when user does not exist", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(service.getUserById(999)).rejects.toThrow(ApiError);
      await expect(service.getUserById(999)).rejects.toThrow("User not found");
    });
  });

  describe("createUser", () => {
    it("should create a user and hash the password", async () => {
      const input = new User({
        name: "Jane",
        email: "jane@example.com",
        password: "plaintext123",
      });
      repo.create.mockResolvedValue(mockUser);

      const result = await service.createUser(input);

      expect(repo.create).toHaveBeenCalledTimes(1);
      const createdArg = repo.create.mock.calls[0][0];
      expect(createdArg.password).not.toBe("plaintext123");
      expect(await bcryptjs.compare("plaintext123", createdArg.password!)).toBe(
        true,
      );
      expect(result).toEqual(mockUser);
    });

    it("should throw when validation fails (missing email)", async () => {
      const input = new User({
        name: "Jane",
        email: "",
        password: "password123",
      });

      await expect(service.createUser(input)).rejects.toThrow(
        DomainValidationError,
      );
      await expect(service.createUser(input)).rejects.toThrow(
        "Email is required",
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("should create user without hashing when no password provided", async () => {
      const input = new User({ name: "Jane", email: "jane@example.com" });
      repo.create.mockResolvedValue(mockUser);

      await service.createUser(input);

      const createdArg = repo.create.mock.calls[0][0];
      expect(createdArg.password).toBeUndefined();
    });
  });

  describe("updateUser", () => {
    it("should update a user", async () => {
      const updatedUser = new User({
        ...mockUser,
        name: "Updated Name",
      });
      repo.update.mockResolvedValue(updatedUser);

      const result = await service.updateUser(1, { name: "Updated Name" });

      expect(repo.update).toHaveBeenCalledWith(1, { name: "Updated Name" });
      expect(result.name).toBe("Updated Name");
    });

    it("should throw when id in body does not match param id", async () => {
      await expect(
        service.updateUser(1, { id: 2, name: "Test" } as Partial<User>),
      ).rejects.toThrow(ApiError);
      await expect(
        service.updateUser(1, { id: 2, name: "Test" } as Partial<User>),
      ).rejects.toThrow("User id does not match");
    });

    it("should hash password when updating with a new password", async () => {
      repo.update.mockResolvedValue(mockUser);

      await service.updateUser(1, { password: "newpassword" });

      const updateArg = repo.update.mock.calls[0][1];
      expect(updateArg.password).not.toBe("newpassword");
      expect(await bcryptjs.compare("newpassword", updateArg.password!)).toBe(
        true,
      );
    });
  });

  describe("deleteUser", () => {
    it("should delete a user", async () => {
      repo.delete.mockResolvedValue();

      await service.deleteUser(1);

      expect(repo.delete).toHaveBeenCalledWith(1);
    });
  });
});
