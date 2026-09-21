import { Contact } from "../../domain/entities/Contact";

const userId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";

describe("Contact Entity", () => {
  describe("constructor", () => {
    it("should create a contact with all properties", () => {
      const contact = new Contact({
        id: "019576a0-d7b6-7d6d-af6a-2b7545f5ac70",
        name: "Ana",
        color: "TEAL",
        email: "ana@example.com",
        linkedUserId: "019576a0-d7b6-7d6d-af6a-2b7545f5ac72",
        userId,
      });

      expect(contact.id).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac70");
      expect(contact.name).toBe("Ana");
      expect(contact.color).toBe("TEAL");
      expect(contact.email).toBe("ana@example.com");
      expect(contact.linkedUserId).toBe("019576a0-d7b6-7d6d-af6a-2b7545f5ac72");
      expect(contact.userId).toBe(userId);
      expect(contact.archivedAt).toBeNull();
    });

    it("should mint its own id when none is given", () => {
      const contact = new Contact({ name: "Beto", userId });

      expect(contact.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("should leave colour and email unset when they are not given", () => {
      const contact = new Contact({ name: "Beto", userId });

      expect(contact.color).toBeUndefined();
      expect(contact.email).toBeUndefined();
    });

    it("should default linkedUserId to null, not undefined", () => {
      const contact = new Contact({ name: "Beto", userId });

      expect(contact.linkedUserId).toBeNull();
    });
  });
});
