import { CategoryService } from "../../app/services/CategoryService";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { Category } from "../../domain/entities/Category";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { DEFAULT_CATEGORIES } from "../../shared/defaultCategories";
import { ApiError } from "../../shared/errors";

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
  getByIdIncludingArchived: jest.fn(),
  getOwnById: jest.fn(),
  create: jest.fn(),
  createMany: jest.fn(),
  listSeedKeys: jest.fn().mockResolvedValue([]),
  listArchivedIds: jest.fn().mockResolvedValue([]),
  countByUserId: jest.fn().mockResolvedValue(0),
  update: jest.fn(),
  delete: jest.fn(),
  restore: jest.fn(),
});

const createTxRepoMock = () =>
  ({
    countByCategory: jest.fn().mockResolvedValue(0),
  }) as unknown as jest.Mocked<ITransactionRepository>;

describe("CategoryService", () => {
  let service: CategoryService;
  let repo: jest.Mocked<ICategoryRepository>;
  let txRepo: jest.Mocked<ITransactionRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    txRepo = createTxRepoMock();
    service = new CategoryService(repo, txRepo);
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

      expect(repo.getAllByUserId).toHaveBeenCalledWith(
        testUserId,
        pagination,
        undefined,
      );
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

    it("should pass type filter to repository", async () => {
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

      const filters = { type: "EXPENSE" };
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
      repo.getByIdIncludingArchived.mockResolvedValue(mockCategory);

      const result = await service.getCategoryById(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        testUserId,
      );

      expect(repo.getByIdIncludingArchived).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
      expect(result.name).toBe("Food");
    });

    it("should throw NotFound when category does not exist", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(null);

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
      repo.getByIdIncludingArchived.mockResolvedValue(mockCategory);
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

  describe("deleteCategory (archive)", () => {
    it("should archive a category (even when it has transactions)", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(mockCategory);
      repo.delete.mockResolvedValue();

      await service.deleteCategory(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        testUserId,
      );

      expect(repo.delete).toHaveBeenCalledWith(
        "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
      );
    });

    it("resolves when a concurrent archive wins the race (idempotent)", async () => {
      repo.getByIdIncludingArchived
        .mockResolvedValueOnce(mockCategory)
        .mockResolvedValueOnce(
          new Category({
            id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
            name: "Food",
            userId: testUserId,
            archivedAt: new Date(),
          }),
        );
      repo.delete.mockRejectedValue(
        new ApiError("NotFound", "Category not found"),
      );

      await expect(
        service.deleteCategory(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          testUserId,
        ),
      ).resolves.toBeUndefined();
    });

    it("should throw NotFound when archiving non-existent category", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(
        service.deleteCategory(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          testUserId,
        ),
      ).rejects.toThrow("Category not found");
    });

    it("should throw Forbidden when archiving another user's category", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(mockCategory);

      await expect(
        service.deleteCategory(
          "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
          "another-user",
        ),
      ).rejects.toThrow("Category not found");

      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe("restoreDefaults [R2-04]", () => {
    it("creates only the defaults whose seedKey is missing", async () => {
      const present = DEFAULT_CATEGORIES.slice(0, 7).map((c) => c.seedKey);
      repo.listSeedKeys.mockResolvedValue(present);
      repo.createMany.mockImplementation(async (cats) =>
        cats.map((c) => new Category(c as Category)),
      );

      const created = await service.restoreDefaults(testUserId);

      expect(created).toHaveLength(DEFAULT_CATEGORIES.length - 7);
      const sentKeys = repo.createMany.mock.calls[0][0].map(
        (c) => (c as Category).seedKey,
      );
      expect(sentKeys).toEqual(
        DEFAULT_CATEGORIES.slice(7).map((c) => c.seedKey),
      );
    });

    it("is a no-op when every seedKey exists (archived included)", async () => {
      repo.listSeedKeys.mockResolvedValue(
        DEFAULT_CATEGORIES.map((c) => c.seedKey),
      );

      const created = await service.restoreDefaults(testUserId);

      expect(created).toEqual([]);
      expect(repo.createMany).not.toHaveBeenCalled();
    });
  });

  describe("type change guard [R2-32]", () => {
    it("blocks changing the type of a category with transactions", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Category({
          id: mockCategory.id,
          name: "Food",
          type: "EXPENSE",
          userId: testUserId,
        }),
      );
      txRepo.countByCategory.mockResolvedValue(3);

      await expect(
        service.updateCategory(mockCategory.id, { type: "INCOME" }, testUserId),
      ).rejects.toThrow("Cannot change the type");
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("allows a type change when the category has no transactions", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        new Category({
          id: mockCategory.id,
          name: "Food",
          type: "EXPENSE",
          userId: testUserId,
        }),
      );
      txRepo.countByCategory.mockResolvedValue(0);
      repo.update.mockResolvedValue(mockCategory);

      await expect(
        service.updateCategory(mockCategory.id, { type: "INCOME" }, testUserId),
      ).resolves.toBeDefined();
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
      repo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(
        service.updateCategory(
          "019576a0-d7b6-7d6d-af6a-000000000000",
          { name: "Updated" },
          testUserId,
        ),
      ).rejects.toThrow("Category not found");
    });
  });

  describe("seedDefaultCategories", () => {
    it("should create all default categories for the user", async () => {
      repo.createMany.mockResolvedValue(
        DEFAULT_CATEGORIES.map(
          (cat) => new Category({ ...cat, userId: testUserId }),
        ),
      );

      const result = await service.seedDefaultCategories(testUserId);

      expect(repo.createMany).toHaveBeenCalledTimes(1);
      const createArg = repo.createMany.mock.calls[0][0];
      expect(createArg).toHaveLength(DEFAULT_CATEGORIES.length);
      expect(result).toHaveLength(DEFAULT_CATEGORIES.length);

      createArg.forEach((cat: Partial<Category>) => {
        expect(cat.userId).toBe(testUserId);
        expect(cat.id).toBeDefined();
      });
    });

    it("should create categories with correct types", async () => {
      repo.createMany.mockResolvedValue(
        DEFAULT_CATEGORIES.map(
          (cat) => new Category({ ...cat, userId: testUserId }),
        ),
      );

      const result = await service.seedDefaultCategories(testUserId);

      const incomeCategories = result.filter((c) => c.type === "INCOME");
      const expenseCategories = result.filter((c) => c.type === "EXPENSE");
      const transferCategories = result.filter((c) => c.type === "TRANSFER");

      const expected = (type: string) =>
        DEFAULT_CATEGORIES.filter((c) => c.type === type).length;
      expect(incomeCategories.length).toBe(expected("INCOME"));
      expect(expenseCategories.length).toBe(expected("EXPENSE"));
      expect(transferCategories.length).toBe(expected("TRANSFER"));
    });

    it("should propagate error when createMany fails", async () => {
      repo.createMany.mockRejectedValue(new Error("DB write failed"));

      await expect(service.seedDefaultCategories(testUserId)).rejects.toThrow(
        "DB write failed",
      );
    });
  });
});
