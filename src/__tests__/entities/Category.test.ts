import { Category } from "../../domain/entities/Category";
import { DomainValidationError } from "../../domain/errors";

describe("Category Entity", () => {
  describe("constructor", () => {
    it("should create a category with all properties", () => {
      const category = new Category({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Food",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
      });

      expect(category.id).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac70");
      expect(category.name).toBe("Food");
      expect(category.userId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac71");
    });
  });

  describe("validate", () => {
    it("should not throw for a valid category", () => {
      const category = new Category({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Food",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
      });
      expect(() => category.validate()).not.toThrow();
    });

    it("should throw DomainValidationError when name is missing", () => {
      const category = new Category({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "" as unknown as string,
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
      });

      expect(() => category.validate()).toThrow(DomainValidationError);
      expect(() => category.validate()).toThrow("'name' is required");
    });

    it("should throw DomainValidationError when userId is missing", () => {
      const category = new Category({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Food",
        userId: "" as unknown as string,
      });

      expect(() => category.validate()).toThrow(DomainValidationError);
      expect(() => category.validate()).toThrow("'userId' is required");
    });
  });
});
