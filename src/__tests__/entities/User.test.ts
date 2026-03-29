import { User } from "../../domain/entities/User";
import { ApiError } from "../../shared/errors";

describe("User Entity", () => {
  const validProps = {
    id: 1,
    name: "John Doe",
    email: "john@example.com",
    password: "hashed_pw",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe("constructor", () => {
    it("should create a user with all properties", () => {
      const user = new User(validProps);

      expect(user.id).toBe(validProps.id);
      expect(user.name).toBe(validProps.name);
      expect(user.email).toBe(validProps.email);
      expect(user.password).toBe(validProps.password);
      expect(user.createdAt).toBe(validProps.createdAt);
      expect(user.updatedAt).toBe(validProps.updatedAt);
    });

    it("should create a user without optional fields", () => {
      const user = new User({ name: "Jane", email: "jane@example.com" });

      expect(user.name).toBe("Jane");
      expect(user.email).toBe("jane@example.com");
      expect(user.password).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("should not throw for a valid user", () => {
      const user = new User(validProps);
      expect(() => user.validate()).not.toThrow();
    });

    it("should throw ApiError when email is missing", () => {
      const user = new User({ ...validProps, email: "" });

      expect(() => user.validate()).toThrow(ApiError);
      expect(() => user.validate()).toThrow("Email is required");
    });

    it("should throw ApiError when name is missing", () => {
      const user = new User({ ...validProps, name: "" });

      expect(() => user.validate()).toThrow(ApiError);
      expect(() => user.validate()).toThrow("Name is required");
    });
  });
});
