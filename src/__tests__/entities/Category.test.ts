import { Category } from "../../domain/entities/Category";
import { ApiError } from "../../shared/errors";

describe("Category Entity", () => {
  describe("constructor", () => {
    it("should create a category with all properties", () => {
      const category = new Category({ id: 1, name: "Food" });

      expect(category.id).toBe(1);
      expect(category.name).toBe("Food");
    });
  });

  describe("validate", () => {
    it("should not throw for a valid category", () => {
      const category = new Category({ id: 1, name: "Food" });
      expect(() => category.validate()).not.toThrow();
    });

    it("should throw ApiError when name is missing", () => {
      const category = new Category({
        id: 1,
        name: "" as unknown as string,
      });

      expect(() => category.validate()).toThrow(ApiError);
      expect(() => category.validate()).toThrow("'name' is required");
    });
  });
});
