import { v7 as uuidv7 } from "uuid";

import {
  SettlementCounterparty,
  SharedSettlement,
} from "../../../domain/entities/SharedSettlement";
import {
  ISharedSettlementRepository,
  SettlementFilters,
} from "../../../domain/repositories/sharedSettlement/ISharedSettlementRepository";
import { SETTLEMENT_PARTIES } from "../../../shared/constants";
import { ApiError } from "../../../shared/errors";
import { fromCents, toCents } from "../../../shared/money";
import {
  buildPaginatedResult,
  pageQueryLimit,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ChangeCursor } from "../../../shared/syncCursor";
import { TxSession } from "../../../shared/unitOfWork";
import {
  ISharedSettlementDocument,
  SharedSettlementModel,
} from "../../models/SharedSettlementModel";
import { CHANGE_FEED_SORT, changesSinceFilter } from "../changeFeed";
import { invalidCursor } from "../keysetCursor";

// Newest first: what somebody asks about a person is what happened last.
const SETTLEMENT_SORT = { date: -1, _id: -1 } as const;

const counterpartyFilter = (
  counterparty: SettlementCounterparty,
): Record<string, unknown> =>
  counterparty.kind === SETTLEMENT_PARTIES.CONTACT
    ? { "counterparty.contactId": counterparty.contactId }
    : { "counterparty.expenseId": counterparty.expenseId };

export class SharedSettlementRepository implements ISharedSettlementRepository {
  private toEntity(doc: ISharedSettlementDocument): SharedSettlement {
    return new SharedSettlement({
      id: doc._id,
      userId: doc.userId,
      counterparty: {
        kind: doc.counterparty.kind,
        contactId: doc.counterparty.contactId,
        expenseId: doc.counterparty.expenseId,
      },
      date: doc.date,
      collected: fromCents(doc.collected),
      paid: fromCents(doc.paid),
      outsideApp: doc.outsideApp,
      currency: doc.currency,
      deletedAt: doc.deletedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  private toStorage(
    settlement: Partial<SharedSettlement>,
  ): Record<string, unknown> {
    const doc: Record<string, unknown> = { ...settlement };
    if (settlement.collected !== undefined) {
      doc.collected = toCents(settlement.collected);
    }
    if (settlement.paid !== undefined) {
      doc.paid = toCents(settlement.paid);
    }
    return doc;
  }

  async create(
    settlement: Partial<SharedSettlement>,
    session?: TxSession,
  ): Promise<SharedSettlement> {
    const id = settlement.id ?? uuidv7();
    const [doc] = await SharedSettlementModel.create(
      [{ _id: id, ...this.toStorage(settlement) }],
      { session: session ?? undefined },
    );
    return this.toEntity(doc.toObject());
  }

  async update(
    id: string,
    settlement: Partial<SharedSettlement>,
    session?: TxSession,
  ): Promise<SharedSettlement> {
    const doc = await SharedSettlementModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      this.toStorage(settlement),
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Payment not found");
    }
    return this.toEntity(doc);
  }

  async delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedSettlement> {
    const doc = await SharedSettlementModel.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      { deletedAt: new Date() },
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Payment not found");
    }
    return this.toEntity(doc);
  }

  async changesSince(
    userId: string,
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<SharedSettlement[]> {
    const docs = await SharedSettlementModel.find(
      changesSinceFilter(userId, cursor),
    )
      .sort(CHANGE_FEED_SORT)
      .limit(limit)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async getById(
    id: string,
    session?: TxSession,
  ): Promise<SharedSettlement | null> {
    const doc = await SharedSettlementModel.findOne({ _id: id })
      .session(session ?? null)
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getOwnById(
    id: string,
    userId: string,
  ): Promise<SharedSettlement | null> {
    const doc = await SharedSettlementModel.findOne({ _id: id, userId }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedSettlement>> {
    return this.paginatedFind({ deletedAt: null }, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: SettlementFilters,
  ): Promise<PaginatedResult<SharedSettlement>> {
    const filter: Record<string, unknown> = { userId, deletedAt: null };
    if (filters?.contactId) {
      filter["counterparty.contactId"] = filters.contactId;
    }
    if (filters?.expenseId) {
      filter["counterparty.expenseId"] = filters.expenseId;
    }
    return this.paginatedFind(filter, pagination);
  }

  async listByCounterparty(
    userId: string,
    counterparty: SettlementCounterparty,
    session?: TxSession,
  ): Promise<SharedSettlement[]> {
    const docs = await SharedSettlementModel.find({
      userId,
      deletedAt: null,
      ...counterpartyFilter(counterparty),
    })
      .session(session ?? null)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedSettlement>> {
    const { limit, offset, cursor } = pagination;
    let filter: Record<string, unknown> = baseFilter;
    if (cursor) {
      // The pivot is read inside the same filter, so no other list's row can order this page.
      const pivot = await SharedSettlementModel.findOne({
        ...baseFilter,
        _id: cursor,
      } as never)
        .select("date")
        .lean();
      if (!pivot) throw invalidCursor();
      filter = {
        $and: [
          baseFilter,
          {
            $or: [
              { date: { $lt: pivot.date } },
              { date: pivot.date, _id: { $lt: cursor } },
            ],
          },
        ],
      };
    }

    const [docs, total] = await Promise.all([
      SharedSettlementModel.find(filter)
        .sort(SETTLEMENT_SORT)
        .skip(cursor ? 0 : offset)
        .limit(pageQueryLimit(limit))
        .lean(),
      SharedSettlementModel.countDocuments(baseFilter),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }
}
