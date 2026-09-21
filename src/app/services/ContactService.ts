import { Contact } from "../../domain/entities/Contact";
import {
  ContactFilters,
  IContactRepository,
} from "../../domain/repositories/contact/IContactRepository";
import { createOrReplay, CreateOutcome } from "../../shared/clientMintedId";
import { assertFresh, guardedWrite } from "../../shared/concurrency";
import { MAX_CONTACTS_PER_USER } from "../../shared/constants";
import { ApiError } from "../../shared/errors";
import { PaginatedResult, PaginationParams } from "../../shared/pagination";
import { CreateContactDTO, UpdateContactDTO } from "../dtos/ContactDTO";

export class ContactService {
  constructor(private repo: IContactRepository) {}

  async getAllContacts(
    userId: string,
    pagination: PaginationParams,
    filters?: ContactFilters,
  ): Promise<PaginatedResult<Contact>> {
    const result = await this.repo.getAllByUserId(userId, pagination, filters);
    return {
      data: result.data.map((contact) => new Contact(contact)),
      pagination: result.pagination,
    };
  }

  // Reads resolve archived contacts too; only the listing hides them by default.
  async getContactById(id: string, userId: string): Promise<Contact> {
    const contact = await this.repo.getByIdIncludingArchived(id);
    if (!contact || contact.userId !== userId) {
      throw new ApiError("NotFound", "Contact not found");
    }
    return new Contact(contact);
  }

  async createContact(
    dto: CreateContactDTO,
    outcome?: CreateOutcome,
  ): Promise<Contact> {
    return createOrReplay({
      clientId: dto.id,
      outcome,
      findOwn: (id) => this.repo.getOwnById(id, dto.userId),
      replay: async (c) => new Contact(c),
      create: () => this.insertContact(dto),
    });
  }

  private async assertRoomForOneMore(userId: string): Promise<void> {
    if ((await this.repo.countByUserId(userId)) >= MAX_CONTACTS_PER_USER) {
      throw new ApiError(
        "BadRequest",
        `Contact limit reached (${MAX_CONTACTS_PER_USER})`,
        "CONTACT_LIMIT_REACHED",
      );
    }
  }

  private async insertContact(dto: CreateContactDTO): Promise<Contact> {
    await this.assertRoomForOneMore(dto.userId);
    return new Contact(await this.repo.create(new Contact(dto)));
  }

  async updateContact(
    id: string,
    dto: UpdateContactDTO,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Contact> {
    if (dto.id && dto.id !== id) {
      throw new ApiError("BadRequest", "Contact id does not match");
    }

    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "Contact not found");
    }
    // Before the archived check: an old-version caller needs to re-read, not a reason it cannot know.
    assertFresh(existing, expectedUpdatedAt, (c) => new Contact(c));
    if (existing.archivedAt) {
      throw new ApiError(
        "BadRequest",
        "Contact is archived; restore it first",
        "RESOURCE_ARCHIVED",
      );
    }

    return guardedWrite(
      expectedUpdatedAt,
      async () =>
        new Contact(
          await this.repo.update(id, dto, undefined, expectedUpdatedAt),
        ),
      () => this.repo.getOwnById(id, userId),
      (c) => new Contact(c),
    );
  }

  // Idempotent, and it answers the archived row so a queued restore can guard on its updatedAt.
  async deleteContact(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Contact> {
    const existing = await this.repo.getByIdIncludingArchived(id);
    if (!existing || existing.userId !== userId) {
      throw new ApiError("NotFound", "Contact not found");
    }
    assertFresh(existing, expectedUpdatedAt, (c) => new Contact(c));
    if (existing.archivedAt) {
      return new Contact(existing);
    }
    try {
      return new Contact(
        await this.repo.delete(id, undefined, expectedUpdatedAt),
      );
    } catch (err) {
      // Lost the race to a concurrent archive: still a success.
      const current = await this.repo.getByIdIncludingArchived(id);
      if (current?.userId === userId) {
        assertFresh(current, expectedUpdatedAt, (c) => new Contact(c));
        if (current.archivedAt) {
          return new Contact(current);
        }
      }
      throw err;
    }
  }

  // Idempotent: restoring an already-active contact returns it unchanged.
  async restoreContact(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<Contact> {
    const current = await this.repo.getByIdIncludingArchived(id);
    if (!current || current.userId !== userId) {
      throw new ApiError("NotFound", "Contact not found");
    }
    assertFresh(current, expectedUpdatedAt, (c) => new Contact(c));
    if (!current.archivedAt) {
      return new Contact(current);
    }
    // The cap is published as the number of ACTIVE contacts, so coming back has to respect it.
    await this.assertRoomForOneMore(userId);

    const restored = await this.repo.restore(
      id,
      userId,
      name,
      expectedUpdatedAt,
    );
    if (restored) {
      return new Contact(restored);
    }
    // Lost the race to a concurrent restore: the same outcome, so still a success.
    const raced = await this.repo.getByIdIncludingArchived(id);
    if (!raced || raced.userId !== userId) {
      throw new ApiError("NotFound", "Contact not found");
    }
    assertFresh(raced, expectedUpdatedAt, (c) => new Contact(c));
    return new Contact(raced);
  }
}
