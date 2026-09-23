import { PipelineStage } from "mongoose";
import { v7 as uuidv7 } from "uuid";

import {
  SharedExpense,
  SharedSplit,
} from "../../../domain/entities/SharedExpense";
import { SettlementCounterparty } from "../../../domain/entities/SharedSettlement";
import {
  GroupTotals,
  ISharedExpenseRepository,
  JoinedScope,
} from "../../../domain/repositories/sharedExpense/ISharedExpenseRepository";
import { SETTLEMENT_PARTIES, SHARE_PARTIES } from "../../../shared/constants";
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
  ISharedExpenseDocument,
  SharedExpenseModel,
} from "../../models/SharedExpenseModel";
import {
  CHANGE_FEED_SORT,
  changesSinceFilter,
  keysetAfter,
} from "../changeFeed";
import { invalidCursor } from "../keysetCursor";

// Newest first: a group is read from the last thing that happened backwards.
const EXPENSE_SORT = { date: -1, _id: -1 } as const;

const centsOrNull = (amount: number | null): number | null =>
  amount === null ? null : toCents(amount);

export class SharedExpenseRepository implements ISharedExpenseRepository {
  private toSplit(doc: ISharedExpenseDocument): SharedSplit {
    return {
      mode: doc.split.mode,
      guests: doc.split.guests
        ? { count: doc.split.guests.count, name: doc.split.guests.name }
        : null,
      shares: doc.split.shares.map((share) => ({
        party: share.party,
        contactId: share.contactId,
        percent: share.percent,
        fixedAmount:
          share.fixedAmount === null ? null : fromCents(share.fixedAmount),
        amount: fromCents(share.amount),
        collected: fromCents(share.collected ?? 0),
      })),
    };
  }

  private toEntity(doc: ISharedExpenseDocument): SharedExpense {
    return new SharedExpense({
      id: doc._id,
      groupId: doc.groupId,
      description: doc.description,
      date: doc.date,
      amount: fromCents(doc.amount),
      paidByContactId: doc.paidByContactId,
      split: this.toSplit(doc),
      customSplit: doc.customSplit,
      userId: doc.userId,
      currency: doc.currency,
      deletedAt: doc.deletedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  private splitToStorage(split: SharedSplit): ISharedExpenseDocument["split"] {
    return {
      mode: split.mode,
      guests: split.guests,
      shares: split.shares.map((share) => ({
        party: share.party,
        contactId: share.contactId,
        percent: share.percent,
        fixedAmount: centsOrNull(share.fixedAmount),
        amount: toCents(share.amount),
        collected: toCents(share.collected ?? 0),
      })),
    };
  }

  private toStorage(expense: Partial<SharedExpense>): Record<string, unknown> {
    const doc: Record<string, unknown> = { ...expense };
    if (expense.amount !== undefined) {
      doc.amount = toCents(expense.amount);
    }
    if (expense.split !== undefined) {
      doc.split = this.splitToStorage(expense.split);
    }
    return doc;
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedExpense>> {
    const { limit, offset, cursor } = pagination;
    let filter: Record<string, unknown> = baseFilter;
    if (cursor) {
      const { userId: owner, groupId } = baseFilter;
      // The pivot is read inside the same filter, so no other list's row can order this page.
      const pivot = await SharedExpenseModel.findOne({
        _id: cursor,
        ...(typeof owner === "string" ? { userId: owner } : {}),
        ...(typeof groupId === "string" ? { groupId } : {}),
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
      SharedExpenseModel.find(filter)
        .sort(EXPENSE_SORT)
        .skip(cursor ? 0 : offset)
        .limit(pageQueryLimit(limit))
        .lean(),
      SharedExpenseModel.countDocuments(baseFilter),
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
  ): Promise<SharedExpense[]> {
    const docs = await SharedExpenseModel.find(
      changesSinceFilter(userId, cursor),
    )
      .sort(CHANGE_FEED_SORT)
      .limit(limit)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async changesInGroups(
    scopes: JoinedScope[],
    cursor: ChangeCursor | undefined,
    limit: number,
  ): Promise<SharedExpense[]> {
    if (scopes.length === 0) return [];
    const docs = await SharedExpenseModel.find({
      ...keysetAfter(cursor),
      $and: [
        {
          $or: scopes.map(({ groupId, after }) =>
            after ? { groupId, updatedAt: { $gt: after } } : { groupId },
          ),
        },
      ],
    })
      .sort(CHANGE_FEED_SORT)
      .limit(limit)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async atJoin(
    groupId: string,
    joinedAt: Date,
    afterId: string | null,
    limit: number,
  ): Promise<SharedExpense[]> {
    const docs = await SharedExpenseModel.find({
      groupId,
      updatedAt: { $lte: joinedAt },
      ...(afterId && { _id: { $gt: afterId } }),
    })
      .sort({ _id: 1 })
      .limit(limit)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async getById(
    id: string,
    session?: TxSession,
  ): Promise<SharedExpense | null> {
    const doc = await SharedExpenseModel.findOne({ _id: id, deletedAt: null })
      .session(session ?? null)
      .lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getOwnById(id: string, userId: string): Promise<SharedExpense | null> {
    const doc = await SharedExpenseModel.findOne({ _id: id, userId }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getByIdIncludingDeleted(id: string): Promise<SharedExpense | null> {
    const doc = await SharedExpenseModel.findOne({ _id: id }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedExpense>> {
    return this.paginatedFind({ deletedAt: null }, pagination);
  }

  async getAllByGroup(
    userId: string,
    groupId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<SharedExpense>> {
    return this.paginatedFind({ userId, groupId, deletedAt: null }, pagination);
  }

  async listByGroup(
    userId: string,
    groupId: string,
    session?: TxSession,
  ): Promise<SharedExpense[]> {
    const docs = await SharedExpenseModel.find({
      userId,
      groupId,
      deletedAt: null,
    })
      .sort(EXPENSE_SORT)
      .session(session ?? null)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async listByCounterparty(
    userId: string,
    counterparty: SettlementCounterparty,
    session?: TxSession,
  ): Promise<SharedExpense[]> {
    // A guest block belongs to one expense and has nothing else to net against.
    const filter =
      counterparty.kind === SETTLEMENT_PARTIES.GUESTS
        ? { _id: counterparty.expenseId }
        : { "split.shares.contactId": counterparty.contactId };
    const docs = await SharedExpenseModel.find({
      userId,
      deletedAt: null,
      ...filter,
    })
      .session(session ?? null)
      .lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async countSharesOfContact(
    userId: string,
    groupId: string,
    contactId: string,
  ): Promise<number> {
    return SharedExpenseModel.countDocuments({
      userId,
      groupId,
      deletedAt: null,
      $or: [
        { "split.shares.contactId": contactId },
        { paidByContactId: contactId },
      ],
    });
  }

  /** Adds up one field of the shares that are yours, or of the shares that are not. */
  private shareSum(
    yours: boolean,
    field: "amount" | "collected" | "open",
  ): Record<string, unknown> {
    const value =
      field === "open"
        ? {
            $subtract: [
              "$$share.amount",
              { $ifNull: ["$$share.collected", 0] },
            ],
          }
        : field === "collected"
          ? { $ifNull: ["$$share.collected", 0] }
          : "$$share.amount";
    return {
      $sum: {
        $map: {
          input: {
            $filter: {
              input: "$split.shares",
              as: "share",
              cond: yours
                ? { $eq: ["$$share.party", SHARE_PARTIES.USER] }
                : { $ne: ["$$share.party", SHARE_PARTIES.USER] },
            },
          },
          as: "share",
          in: value,
        },
      },
    };
  }

  // Only a line you fronted is money owed to you, and only somebody else's is money you owe.
  private whenYouPaid(
    paid: boolean,
    inner: Record<string, unknown>,
  ): Record<string, unknown> {
    const mine = { $eq: [{ $ifNull: ["$paidByContactId", null] }, null] };
    return { $sum: { $cond: [paid ? mine : { $not: [mine] }, inner, 0] } };
  }

  async totalsByGroup(
    userId: string,
    groupIds: string[],
  ): Promise<GroupTotals[]> {
    if (groupIds.length === 0) return [];
    interface TotalsRow {
      _id: string;
      total: number;
      yourShare: number;
      owedToYou: number;
      youOwe: number;
      collected: number;
      expenseCount: number;
      dateFrom: Date;
      dateTo: Date;
    }
    interface PartyRow {
      _id: {
        groupId: string;
        contactId: string | null;
        expenseId: string | null;
      };
      owed: number;
    }
    const [faceted] = await SharedExpenseModel.aggregate<{
      totals: TotalsRow[];
      parties: PartyRow[];
    }>([
      { $match: { userId, groupId: { $in: groupIds }, deletedAt: null } },
      {
        // Who still owes what, so a write-off can take its own share out of the total.
        // The accumulators are built above, which the driver's types cannot follow.
        $facet: {
          parties: [
            { $match: { paidByContactId: null } },
            { $unwind: "$split.shares" },
            { $match: { "split.shares.party": { $ne: SHARE_PARTIES.USER } } },
            {
              $group: {
                _id: {
                  groupId: "$groupId",
                  contactId: "$split.shares.contactId",
                  expenseId: {
                    $cond: [
                      { $eq: ["$split.shares.party", SHARE_PARTIES.GUESTS] },
                      "$_id",
                      null,
                    ],
                  },
                },
                owed: {
                  $sum: {
                    $subtract: [
                      "$split.shares.amount",
                      { $ifNull: ["$split.shares.collected", 0] },
                    ],
                  },
                },
              },
            },
          ],
          totals: [
            {
              $group: {
                _id: "$groupId",
                total: { $sum: "$amount" },
                yourShare: { $sum: this.shareSum(true, "amount") },
                owedToYou: this.whenYouPaid(true, this.shareSum(false, "open")),
                collected: this.whenYouPaid(
                  true,
                  this.shareSum(false, "collected"),
                ),
                youOwe: this.whenYouPaid(false, this.shareSum(true, "open")),
                expenseCount: { $sum: 1 },
                dateFrom: { $min: "$date" },
                dateTo: { $max: "$date" },
              },
            },
          ],
        },
      } as unknown as PipelineStage,
    ]);
    const byGroup = new Map<string, GroupTotals["owedByParty"]>();
    for (const party of faceted?.parties ?? []) {
      const rows = byGroup.get(party._id.groupId) ?? [];
      rows.push({
        contactId: party._id.contactId,
        expenseId: party._id.expenseId,
        owedCents: party.owed,
      });
      byGroup.set(party._id.groupId, rows);
    }
    return (faceted?.totals ?? []).map((row) => ({
      groupId: row._id,
      total: fromCents(row.total),
      yourShare: fromCents(row.yourShare),
      owedToYou: fromCents(row.owedToYou),
      youOwe: fromCents(row.youOwe),
      collected: fromCents(row.collected),
      owedByParty: byGroup.get(row._id) ?? [],
      expenseCount: row.expenseCount,
      dateFrom: row.dateFrom ?? null,
      dateTo: row.dateTo ?? null,
    }));
  }

  async create(
    expense: Partial<SharedExpense>,
    session?: TxSession,
  ): Promise<SharedExpense> {
    const id = expense.id ?? uuidv7();
    const [doc] = await SharedExpenseModel.create(
      [{ _id: id, ...this.toStorage(expense) }],
      { session: session ?? undefined },
    );
    return this.toEntity(doc.toObject());
  }

  async update(
    id: string,
    expense: Partial<SharedExpense>,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedExpense> {
    const doc = await SharedExpenseModel.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      this.toStorage(expense),
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Shared expense not found");
    }
    return this.toEntity(doc);
  }

  async delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<SharedExpense> {
    const doc = await SharedExpenseModel.findOneAndUpdate(
      {
        _id: id,
        deletedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      { deletedAt: new Date() },
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Shared expense not found");
    }
    return this.toEntity(doc);
  }

  async replaceSplits(
    updates: { id: string; split: SharedSplit }[],
    session: TxSession,
  ): Promise<void> {
    if (updates.length === 0) return;
    await SharedExpenseModel.bulkWrite(
      updates.map(({ id, split }) => ({
        updateOne: {
          filter: { _id: id, deletedAt: null },
          update: { $set: { split: this.splitToStorage(split) } },
        },
      })),
      { session },
    );
  }
}
