import { CategoryService } from "../../app/services/CategoryService";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { Category } from "../../domain/entities/Category";
import { ApiError } from "../../shared/errors";

const mockCategory = new Category({ id: 1, name: "Food" });

const createMockRepo = (): jest.Mocked<ICategoryRepository> => ({
  getAll: jest.fn(),
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
    it("should return all categories", async () => {
      repo.getAll.mockResolvedValue([mockCategory]);

      const result = await service.getAllCategories();

      expect(repo.getAll).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Food");
    });

    it("should return empty array when no categories exist", async () => {
      repo.getAll.mockResolvedValue([]);

      const result = await service.getAllCategories();

      expect(result).toEqual([]);
    });
  });

  describe("getCategoryById", () => {
    it("should return category when found", async () => {
      repo.getById.mockResolvedValue(mockCategory);

      const result = await service.getCategoryById(1);

      expect(repo.getById).toHaveBeenCalledWith(1);
      expect(result.name).toBe("Food");
    });

    it("should throw NotFound when category does not exist", async () => {
      repo.getById.mockResolvedValue(null);

      await expect(service.getCategoryById(999)).rejects.toThrow(ApiError);
      await expect(service.getCategoryById(999)).rejects.toThrow(
        "Category not found",
      );
    });
  });

  describe("createCategory", () => {
    it("should create and return a category", async () => {
      repo.create.mockResolvedValue(mockCategory);

      const result = await service.createCategory(
        new Category({ id: 0, name: "Food" }),
      );

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(result.name).toBe("Food");
    });

    it("should throw when validation fails (missing name)", async () => {
      const invalid = new Category({
        id: 0,
        name: "" as unknown as string,
      });

      await expect(service.createCategory(invalid)).rejects.toThrow(ApiError);
      await expect(service.createCategory(invalid)).rejects.toThrow(
        "'name' is required",
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("updateCategory", () => {
    it("should update a category", async () => {
      const updated = new Category({ id: 1, name: "Transport" });
      repo.update.mockResolvedValue(updated);

      const result = await service.updateCategory(1, { name: "Transport" });

      expect(repo.update).toHaveBeenCalledWith(1, { name: "Transport" });
      expect(result.name).toBe("Transport");
    });

    it("should throw when id in body does not match param id", async () => {
      await expect(
        service.updateCategory(1, { id: 2 } as Partial<Category>),
      ).rejects.toThrow(ApiError);
      await expect(
        service.updateCategory(1, { id: 2 } as Partial<Category>),
      ).rejects.toThrow("Category id does not match");
    });
  });

  describe("deleteCategory", () => {
    it("should delete a category", async () => {
      repo.delete.mockResolvedValue();

      await service.deleteCategory(1);

      expect(repo.delete).toHaveBeenCalledWith(1);
    });
  });
});
