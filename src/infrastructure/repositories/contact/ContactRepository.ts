import { UpdateQuery } from "mongoose";
import { v7 as uuidv7 } from "uuid";

import { Contact } from "../../../domain/entities/Contact";
import {
  ContactFilters,
  ContactWrite,
  IContactRepository,
} from "../../../domain/repositories/contact/IContactRepository";
import { ApiError } from "../../../shared/errors";
import {
  buildPaginatedResult,
  pageQueryLimit,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ChangeCursor } from "../../../shared/syncCursor";
import { TxSession } from "../../../shared/unitOfWork";
import { ContactModel, IContactDocument } from "../../models/ContactModel";
import { CHANGE_FEED_SORT, changesSinceFilter } from "../changeFeed";
import { ID_CURSOR_SORT, idCursorFilter } from "../keysetCursor";

const CLEARABLE_FIELDS = ["color", "email"] as const;

export class ContactRepository implements IContactRepository {
  private toEntity(doc: IContactDocument): Contact {
    return new Contact({
      id: doc._id,
      name: doc.name,
      color: doc.color,
      email: doc.email,
      userId: doc.userId,
      archivedAt: doc.archivedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  // A cleared field leaves the document rather than staying in it as null: absent is the only "unset".
  private toUpdate(contact: ContactWrite): UpdateQuery<IContactDocument> {
    const set: Record<string, unknown> = { ...contact };
    const unset: Record<string, ""> = {};
    for (const field of CLEARABLE_FIELDS) {
      if (contact[field] === null) {
        delete set[field];
        unset[field] = "";
      }
    }
    if (Object.keys(unset).length === 0) {
      return set;
    }
    return Object.keys(set).length === 0
      ? { $unset: unset }
      : { $set: set, $unset: unset };
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Contact>> {
    const { limit, offset, cursor } = pagination;
    const filter = cursor
      ? await idCursorFilter(ContactModel, baseFilter, cursor)
      : { ...baseFilter };

    const [docs, total] = await Promise.all([
      ContactModel.find(filter)
        .sort(ID_CURSOR_SORT)
        .skip(cursor ? 0 : offset)
        .limit(pageQueryLimit(limit))
        .lean(),
      ContactModel.countDocuments(baseFilter),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async changesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<Contact[]> {
    const docs = await ContactModel.find(changesSinceFilter(userId, cursor))
      .sort(CHANGE_FEED_SORT)
      .limit(limit)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async getById(id: string, session?: TxSession): Promise<Contact | null> {
    const doc = await ContactModel.findOne({ _id: id, archivedAt: null })
      .session(session ?? null)
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getOwnById(id: string, userId: string): Promise<Contact | null> {
    const doc = await ContactModel.findOne({ _id: id, userId }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getManyIncludingArchived(ids: string[]): Promise<Contact[]> {
    if (ids.length === 0) return [];
    const docs = await ContactModel.find({ _id: { $in: ids } }).lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async getByIdIncludingArchived(id: string): Promise<Contact | null> {
    const doc = await ContactModel.findOne({ _id: id }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Contact>> {
    return this.paginatedFind({ archivedAt: null }, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: ContactFilters,
  ): Promise<PaginatedResult<Contact>> {
    const filter: Record<string, unknown> = { userId };
    if (!filters?.includeArchived) {
      filter.archivedAt = null;
    }
    if (filters?.ids?.length) {
      filter._id = { $in: filters.ids };
    }
    return this.paginatedFind(filter, pagination);
  }

  async create(
    contact: Partial<Contact>,
    session?: TxSession,
  ): Promise<Contact> {
    const id = contact.id ?? uuidv7();
    const [doc] = await ContactModel.create([{ _id: id, ...contact }], {
      session: session ?? undefined,
    });
    return this.toEntity(doc.toObject());
  }

  async listActiveIds(userId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const docs = await ContactModel.find({
      userId,
      _id: { $in: ids },
      archivedAt: null,
    })
      .select("_id")
      .lean();
    return docs.map((doc) => doc._id);
  }

  async countByUserId(userId: string): Promise<number> {
    return ContactModel.countDocuments({ userId, archivedAt: null });
  }

  async update(
    id: string,
    contact: ContactWrite,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<Contact> {
    const doc = await ContactModel.findOneAndUpdate(
      {
        _id: id,
        archivedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      this.toUpdate(contact),
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Contact not found");
    }
    return this.toEntity(doc);
  }

  async delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<Contact> {
    const doc = await ContactModel.findOneAndUpdate(
      {
        _id: id,
        archivedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      { archivedAt: new Date() },
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Contact not found");
    }
    return this.toEntity(doc);
  }

  async restore(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<Contact | null> {
    const doc = await ContactModel.findOneAndUpdate(
      {
        _id: id,
        userId,
        archivedAt: { $ne: null },
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      { archivedAt: null, ...(name ? { name } : {}) },
      { new: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }
}
