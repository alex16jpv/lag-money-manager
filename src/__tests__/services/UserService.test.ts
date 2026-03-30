import { UserService } from "../../app/services/UserService";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { User } from "../../domain/entities/User";
import { ApiError } from "../../shared/errors";
import bcryptjs from "bcryptjs";
import { UpdateUserDTO } from "../../app/dtos/UserDTO";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";

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
    const pagination: PaginationParams = { limit: 20, offset: 0 };

    it("should return paginated users", async () => {
      const paginatedResult: PaginatedResult<User> = {
        data: [mockUser],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      };
      repo.getAll.mockResolvedValue(paginatedResult);

      const result = await service.getAllUsers(pagination);

      expect(repo.getAll).toHaveBeenCalledWith(pagination);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("John Doe");
      expect(result.pagination.total).toBe(1);
    });

    it("should return empty list when no users exist", async () => {
      const paginatedResult: PaginatedResult<User> = {
        data: [],
        pagination: {
          limit: 20,
          offset: 0,
          total: 0,
          hasMore: false,
          nextCursor: null,
        },
      };
      repo.getAll.mockResolvedValue(paginatedResult);

      const result = await service.getAllUsers(pagination);

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
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
      ).rejects.toThrow("Access denied");
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
      ).rejects.toThrow("Access denied");
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

    it("should hash password when updating with a new password", async () => {
      repo.update.mockResolvedValue(mockUser);

      await service.updateUser(
        testUserId,
        {
          password: "newpassword",
        },
        testUserId,
      );

      const updateArg = repo.update.mock.calls[0][1];
      expect(updateArg.password).not.toBe("newpassword");
      expect(await bcryptjs.compare("newpassword", updateArg.password!)).toBe(
        true,
      );
    });
  });

  describe("deleteUser", () => {
    it("should delete the authenticated user", async () => {
      repo.delete.mockResolvedValue();

      await service.deleteUser(testUserId, testUserId);

      expect(repo.delete).toHaveBeenCalledWith(testUserId);
    });

    it("should throw Forbidden when deleting another user", async () => {
      await expect(
        service.deleteUser("019576a0-d7b6-7d6d-af6a-000000000000", testUserId),
      ).rejects.toThrow("Access denied");
    });
  });
});
