import { ContactService } from "../../app/services/ContactService";
import { Contact } from "../../domain/entities/Contact";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { MAX_CONTACTS_PER_USER } from "../../shared/constants";
import { ApiError, StaleUpdateError } from "../../shared/errors";

const testUserId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";
const otherUserId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac7f";
const contactId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";
const version = new Date("2026-09-20T10:00:00.000Z");

const makeContact = (props: Partial<Contact> = {}): Contact =>
  new Contact({
    id: contactId,
    name: "Ana",
    userId: testUserId,
    updatedAt: version,
    ...props,
  });

const createMockRepo = (): jest.Mocked<IContactRepository> => ({
  getAll: jest.fn(),
  getAllByUserId: jest.fn(),
  getById: jest.fn(),
  getByIdIncludingArchived: jest.fn(),
  getOwnById: jest.fn(),
  listActiveIds: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  countByUserId: jest.fn().mockResolvedValue(0),
  update: jest.fn(),
  delete: jest.fn(),
  restore: jest.fn(),
});

describe("ContactService", () => {
  let service: ContactService;
  let repo: jest.Mocked<IContactRepository>;

  beforeEach(() => {
    repo = createMockRepo();
    service = new ContactService(repo);
  });

  describe("getAllContacts", () => {
    const pagination = { limit: 20, offset: 0 };

    it("returns the user's contacts", async () => {
      repo.getAllByUserId.mockResolvedValue({
        data: [makeContact()],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const result = await service.getAllContacts(testUserId, pagination);

      expect(repo.getAllByUserId).toHaveBeenCalledWith(
        testUserId,
        pagination,
        undefined,
      );
      expect(result.data[0].name).toBe("Ana");
    });

    it("passes the filters through", async () => {
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

      await service.getAllContacts(testUserId, pagination, {
        includeArchived: true,
      });

      expect(repo.getAllByUserId).toHaveBeenCalledWith(testUserId, pagination, {
        includeArchived: true,
      });
    });
  });

  describe("getContactById", () => {
    it("resolves an archived contact too", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        makeContact({ archivedAt: new Date() }),
      );

      const contact = await service.getContactById(contactId, testUserId);

      expect(contact.archivedAt).not.toBeNull();
    });

    it("answers 404 for somebody else's contact", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        makeContact({ userId: otherUserId }),
      );

      await expect(
        service.getContactById(contactId, testUserId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("answers 404 when there is none", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(
        service.getContactById(contactId, testUserId),
      ).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe("createContact", () => {
    it("creates the contact", async () => {
      repo.create.mockImplementation(async (c) => c as Contact);

      const created = await service.createContact({
        name: "Ana",
        email: "ana@example.com",
        userId: testUserId,
      });

      expect(created.name).toBe("Ana");
      expect(created.linkedUserId).toBeNull();
      expect(repo.create).toHaveBeenCalled();
    });

    it("refuses once the user is at the limit", async () => {
      repo.countByUserId.mockResolvedValue(MAX_CONTACTS_PER_USER);

      await expect(
        service.createContact({ name: "Ana", userId: testUserId }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "CONTACT_LIMIT_REACHED",
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("counts only up to the limit, so the last one still fits", async () => {
      repo.countByUserId.mockResolvedValue(MAX_CONTACTS_PER_USER - 1);
      repo.create.mockImplementation(async (c) => c as Contact);

      await expect(
        service.createContact({ name: "Ana", userId: testUserId }),
      ).resolves.toBeInstanceOf(Contact);
    });

    it("replays a client-minted id the user already owns, with 200", async () => {
      const stored = makeContact({ name: "Ana renamed elsewhere" });
      repo.getOwnById.mockResolvedValue(stored);
      const outcome = { replayed: false };

      const result = await service.createContact(
        { id: contactId, name: "Ana", userId: testUserId },
        outcome,
      );

      expect(outcome.replayed).toBe(true);
      expect(result.name).toBe("Ana renamed elsewhere");
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("updateContact", () => {
    it("updates an active contact", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(makeContact());
      repo.update.mockResolvedValue(makeContact({ name: "Ana María" }));

      const updated = await service.updateContact(
        contactId,
        { name: "Ana María" },
        testUserId,
      );

      expect(updated.name).toBe("Ana María");
    });

    it("refuses an archived contact with RESOURCE_ARCHIVED", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        makeContact({ archivedAt: new Date() }),
      );

      await expect(
        service.updateContact(contactId, { name: "Ana" }, testUserId),
      ).rejects.toMatchObject({ code: "RESOURCE_ARCHIVED" });
    });

    it("refuses a body whose id contradicts the path", async () => {
      await expect(
        service.updateContact(
          contactId,
          { id: otherUserId, name: "Ana" },
          testUserId,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("answers STALE_UPDATE when If-Match names another version", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(makeContact());

      await expect(
        service.updateContact(
          contactId,
          { name: "Ana" },
          testUserId,
          new Date("2026-09-19T10:00:00.000Z"),
        ),
      ).rejects.toBeInstanceOf(StaleUpdateError);
    });

    it("answers 404 for somebody else's contact", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        makeContact({ userId: otherUserId }),
      );

      await expect(
        service.updateContact(contactId, { name: "Ana" }, testUserId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("deleteContact", () => {
    it("archives an active contact and answers it", async () => {
      const archived = makeContact({ archivedAt: new Date() });
      repo.getByIdIncludingArchived.mockResolvedValue(makeContact());
      repo.delete.mockResolvedValue(archived);

      const result = await service.deleteContact(contactId, testUserId);

      expect(result.archivedAt).not.toBeNull();
    });

    it("is idempotent on an already-archived contact", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        makeContact({ archivedAt: new Date() }),
      );

      await service.deleteContact(contactId, testUserId);

      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("still succeeds when a concurrent archive won the race", async () => {
      repo.getByIdIncludingArchived
        .mockResolvedValueOnce(makeContact())
        .mockResolvedValueOnce(makeContact({ archivedAt: new Date() }));
      repo.delete.mockRejectedValue(new ApiError("NotFound"));

      await expect(
        service.deleteContact(contactId, testUserId),
      ).resolves.toMatchObject({ id: contactId });
    });

    it("answers 404 for somebody else's contact", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(
        makeContact({ userId: otherUserId }),
      );

      await expect(
        service.deleteContact(contactId, testUserId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("restoreContact", () => {
    const archived = () => makeContact({ archivedAt: new Date() });

    it("restores an archived contact", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(archived());
      repo.restore.mockResolvedValue(makeContact());

      const restored = await service.restoreContact(contactId, testUserId);

      expect(restored.archivedAt).toBeNull();
      expect(repo.restore).toHaveBeenCalledWith(
        contactId,
        testUserId,
        undefined,
        undefined,
      );
    });

    it("renames in the same write when a name is given", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(archived());
      repo.restore.mockResolvedValue(makeContact({ name: "Ana B" }));

      await service.restoreContact(contactId, testUserId, "Ana B");

      expect(repo.restore).toHaveBeenCalledWith(
        contactId,
        testUserId,
        "Ana B",
        undefined,
      );
    });

    it("is idempotent on an already-active contact, without spending the cap", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(makeContact());
      repo.countByUserId.mockResolvedValue(MAX_CONTACTS_PER_USER);

      const result = await service.restoreContact(contactId, testUserId);

      expect(result.archivedAt).toBeNull();
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("refuses to bring one back over the cap, which is published as active contacts", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(archived());
      repo.countByUserId.mockResolvedValue(MAX_CONTACTS_PER_USER);

      await expect(
        service.restoreContact(contactId, testUserId),
      ).rejects.toMatchObject({ code: "CONTACT_LIMIT_REACHED" });
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it("still succeeds when a concurrent restore won the race", async () => {
      repo.getByIdIncludingArchived
        .mockResolvedValueOnce(archived())
        .mockResolvedValueOnce(makeContact());
      repo.restore.mockResolvedValue(null);

      await expect(
        service.restoreContact(contactId, testUserId),
      ).resolves.toMatchObject({ archivedAt: null });
    });

    it("answers 404 when nothing of the user's matched", async () => {
      repo.getByIdIncludingArchived.mockResolvedValue(null);

      await expect(
        service.restoreContact(contactId, testUserId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
