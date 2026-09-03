import { User } from "../../domain/entities/User";

describe("User Entity", () => {
  const validProps = {
    id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
    name: "John Doe",
    email: "john@example.com",
    password: "hashed_pw",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe("constructor", () => {
    it("keeps an explicit locale", () => {
      const user = new User({ ...validProps, locale: "es" });
      expect(user.locale).toBe("es");
    });

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

      expect(user.locale).toBe("en");

      expect(user.name).toBe("Jane");
      expect(user.email).toBe("jane@example.com");
      expect(user.password).toBeUndefined();
    });
  });
});
