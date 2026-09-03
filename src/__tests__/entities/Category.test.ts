import { Category } from "../../domain/entities/Category";

describe("Category Entity", () => {
  describe("constructor", () => {
    it("should create a category with all properties", () => {
      const category = new Category({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Food",
        icon: "utensils",
        color: "RED",
        type: "EXPENSE",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
      });

      expect(category.id).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac70");
      expect(category.name).toBe("Food");
      expect(category.icon).toBe("utensils");
      expect(category.color).toBe("RED");
      expect(category.type).toBe("EXPENSE");
      expect(category.userId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac71");
    });

    it("should create a category without icon", () => {
      const category = new Category({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Food",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
      });

      expect(category.icon).toBeUndefined();
    });

    it("should create a category without color and type", () => {
      const category = new Category({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Food",
        userId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac71",
      });

      expect(category.color).toBeUndefined();
      expect(category.type).toBeUndefined();
    });
  });
});
