import { CategoryService } from "../../app/services/CategoryService";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { Category } from "../../domain/entities/Category";
import { ApiError } from "../../shared/errors";
import { CreateCategoryDTO } from "../../app/dtos/CategoryDTO";

const testUserId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";

const mockCategory = new Category({
  id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
  name: "Food",
  userId: testUserId,
});

const createMockRepo = (): jest.Mocked<ICategoryRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

describe("CategoryService", () => {
  let service: CategoryService;
  let repo: jest.Mocked<ICategoryRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new CategoryService(repo);
  });

  describe("getAllCategories", () => {
    const pagination = { limit: 20, offset: 0 };

    it("should return all categories for the user", async () => {
      repo.getAllByUserId.mockResolvedValue({
        data: [mockCategory],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const result = await service.getAllCategories(testUserId, pagination);

      expect(repo.getAllByUserId).toHaveBeenCalledWith(testUserId, pagination, undefined);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("Food");
    });

    it("should return empty array when no categories exist", async () => {
      repo.getAllByUserId.mockResolvedValue({
        data: [],
        pagination: {
          limit: 20,
          offset: 0,
          total: 0,
          hasMore: false,
          nextCursor: null,
        },
      });

      const result = await service.getAllCategories(testUserId, pagination);

      expect(result.data).toEqual([]);
    });

    it("should pass ids filter to repository", async () => {
      repo.getAllByUserId.mockResolvedValue({
        data: [mockCategory],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const filters = { ids: ["019576a0-d7b6-7d6d-af6a-2b7545f5ac70"] };
      await service.getAllCategories(testUserId, pagination, filters);

      expect(repo.getAllByUserId).toHaveBeenCalledWith(
        testUserId,
        pagination,
        filters,
      );
    });
  });

  describe("getCategoryById", () => {
    it("should return category when found and owned by user", async () => {
      repo.getById.mockResolvedValue(mockCategory);

      const result = await service.getCategoryById(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        testUserId,
      );

      expect(repo.getById).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
      expect(result.name).toBe("Food");
    });

    it("should throw NotFound when category does not exist", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(
        service.getCategoryById(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          testUserId,
        ),
      ).rejects.toThrow(ApiError);
      await expect(
        service.getCategoryById(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          testUserId,
        ),
      ).rejects.toThrow("Category not found");
    });
  });

  describe("createCategory", () => {
    it("should create and return a category", async () => {
      repo.create.mockResolvedValue(mockCategory);

      const result = await service.createCategory({
        name: "Food",
        userId: testUserId,
      });

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(result.name).toBe("Food");
    });
  });

  describe("updateCategory", () => {
    it("should update a category", async () => {
      const updated = new Category({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Transport",
        userId: testUserId,
      });
      repo.getById.mockResolvedValue(mockCategory);
      repo.update.mockResolvedValue(updated);

      const result = await service.updateCategory(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        { name: "Transport" },
        testUserId,
      );

      expect(repo.update).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        { name: "Transport" },
      );
      expect(result.name).toBe("Transport");
    });

    it("should throw when id in body does not match param id", async () => {
      await expect(
        service.updateCategory(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
          },
          testUserId,
        ),
      ).rejects.toThrow(ApiError);
      await expect(
        service.updateCategory(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          {
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
          },
          testUserId,
        ),
      ).rejects.toThrow("Category id does not match");
    });
  });

  describe("deleteCategory", () => {
    it("should delete a category", async () => {
      repo.getById.mockResolvedValue(mockCategory);
      repo.delete.mockResolvedValue();

      await service.deleteCategory(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        testUserId,
      );

      expect(repo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
    });

    it("should throw NotFound when deleting non-existent category", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(
        service.deleteCategory(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          testUserId,
        ),
      ).rejects.toThrow("Category not found");
    });
  });

  describe("error propagation", () => {
    it("should propagate repository error on getAll failure", async () => {
      repo.getAllByUserId.mockRejectedValue(new Error("DB connection lost"));

      await expect(
        service.getAllCategories(testUserId, { limit: 20, offset: 0 }),
      ).rejects.toThrow("DB connection lost");
    });

    it("should propagate repository error on create failure", async () => {
      repo.create.mockRejectedValue(new Error("DB write failed"));

      await expect(
        service.createCategory({ name: "Food", userId: testUserId }),
      ).rejects.toThrow("DB write failed");
    });

    it("should throw NotFound on update when category does not exist", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(
        service.updateCategory(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          { name: "Updated" },
          testUserId,
        ),
      ).rejects.toThrow("Category not found");
    });
  });
});
