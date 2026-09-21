import { v7 as uuidv7 } from "uuid";

import { SharedGroup } from "../../../domain/entities/SharedGroup";
import {
  ISharedGroupRepository,
  SharedGroupFilters,
} from "../../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { ApiError } from "../../../shared/errors";
import {
  buildPaginatedResult,
  pageQueryLimit,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import {
  ISharedGroupDocument,
  SharedGroupModel,
} from "../../models/SharedGroupModel";
import { ID_CURSOR_SORT, idCursorFilter } from "../keysetCursor";

const now = (): Date => new Date();

export class SharedGroupRepository implements ISharedGroupRepository {
  private toEntity(doc: ISharedGroupDocument): SharedGroup {
    return new SharedGroup({
      id: doc._id,
      name: doc.name,
      color: doc.color,
      participants: doc.participants.map((p) => ({
        contactId: p.contactId,
        addedAt: p.addedAt,
      })),
      defaultSplit: {
        mode: doc.defaultSplit.mode,
        shares: doc.defaultSplit.shares.map((s) => ({
          contactId: s.contactId,
          percent: s.percent,
        })),
      },
      userId: doc.userId,
      currency: doc.currency,
      archivedAt: doc.archivedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  private toStorage(group: Partial<SharedGroup>): Record<string, unknown> {
    const doc: Record<string, unknown> = { ...group };
    if (group.participants) {
      doc.participants = group.participants.map((p) => ({
        contactId: p.contactId,
        addedAt: p.addedAt ?? now(),
      }));
    }
    return doc;
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedGroup>> {
    const { limit, offset, cursor } = pagination;
    const filter = cursor
      ? await idCursorFilter(SharedGroupModel, baseFilter, cursor)
      : { ...baseFilter };

    const [docs, total] = await Promise.all([
      SharedGroupModel.find(filter)
        .sort(ID_CURSOR_SORT)
        .skip(cursor ? 0 : offset)
        .limit(pageQueryLimit(limit))
        .lean(),
      SharedGroupModel.countDocuments(baseFilter),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async getById(id: string, session?: TxSession): Promise<SharedGroup | null> {
    const doc = await SharedGroupModel.findOne({ _id: id, archivedAt: null })
      .session(session ?? null)
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getOwnById(id: string, userId: string): Promise<SharedGroup | null> {
    const doc = await SharedGroupModel.findOne({ _id: id, userId }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getByIdIncludingArchived(id: string): Promise<SharedGroup | null> {
    const doc = await SharedGroupModel.findOne({ _id: id }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedGroup>> {
    return this.paginatedFind({ archivedAt: null }, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: SharedGroupFilters,
  ): Promise<PaginatedResult<SharedGroup>> {
    const filter: Record<string, unknown> = { userId };
    if (!filters?.includeArchived) {
      filter.archivedAt = null;
    }
    if (filters?.ids?.length) {
      filter._id = { $in: filters.ids };
    }
    if (filters?.contactId) {
      filter["participants.contactId"] = filters.contactId;
    }
    return this.paginatedFind(filter, pagination);
  }

  async create(
    group: Partial<SharedGroup>,
    session?: TxSession,
  ): Promise<SharedGroup> {
    const id = group.id ?? uuidv7();
    const [doc] = await SharedGroupModel.create(
      [{ _id: id, ...this.toStorage(group) }],
      { session: session ?? undefined },
    );
    return this.toEntity(doc.toObject());
  }

  async update(
    id: string,
    group: Partial<SharedGroup>,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroup> {
    const doc = await SharedGroupModel.findOneAndUpdate(
      {
        _id: id,
        archivedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      this.toStorage(group),
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Shared group not found");
    }
    return this.toEntity(doc);
  }

  async delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroup> {
    const doc = await SharedGroupModel.findOneAndUpdate(
      {
        _id: id,
        archivedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      { archivedAt: now() },
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Shared group not found");
    }
    return this.toEntity(doc);
  }

  async restore(
    id: string,
    userId: string,
    name?: string,
    expectedUpdatedAt?: Date,
  ): Promise<SharedGroup | null> {
    const doc = await SharedGroupModel.findOneAndUpdate(
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
