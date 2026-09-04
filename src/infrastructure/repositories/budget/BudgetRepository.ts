import { v7 as uuidv7 } from "uuid";

import { Budget } from "../../../domain/entities/Budget";
import {
  BudgetFilters,
  IBudgetRepository,
  OverlapCandidate,
} from "../../../domain/repositories/budget/IBudgetRepository";
import { ApiError } from "../../../shared/errors";
import { fromCents, toCents } from "../../../shared/money";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { TxSession } from "../../../shared/unitOfWork";
import { BudgetModel, IBudgetDocument } from "../../models/BudgetModel";

export class BudgetRepository implements IBudgetRepository {
  private toEntity(doc: IBudgetDocument): Budget {
    const overrides: Record<string, number> = {};
    const raw = doc.amountOverrides as unknown;
    const entries =
      raw instanceof Map
        ? Array.from(raw.entries())
        : Object.entries((raw as Record<string, number>) ?? {});
    for (const [key, cents] of entries) {
      overrides[key] = fromCents(cents as number);
    }
    return new Budget({
      id: doc._id,
      name: doc.name,
      color: doc.color as Budget["color"],
      categoryIds: doc.categoryIds,
      type: doc.type,
      currency: doc.currency,
      amount: fromCents(doc.amount),
      amountOverrides: overrides,
      periodType: doc.periodType,
      periodStartDate: doc.periodStartDate,
      periodEndDate: doc.periodEndDate,
      effectiveFrom: doc.effectiveFrom ?? null,
      note: doc.note ?? null,
      userId: doc.userId,
      archivedAt: doc.archivedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  private toStorage(budget: Partial<Budget>): Record<string, unknown> {
    const doc: Record<string, unknown> = { ...budget };
    if (budget.amount !== undefined) {
      doc.amount = toCents(budget.amount);
    }
    if (budget.amountOverrides !== undefined) {
      const overrides: Record<string, number> = {};
      for (const [key, amount] of Object.entries(budget.amountOverrides)) {
        overrides[key] = toCents(amount);
      }
      doc.amountOverrides = overrides;
    }
    return doc;
  }

  async getById(id: string): Promise<Budget | null> {
    const doc = await BudgetModel.findOne({ _id: id, archivedAt: null }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getOwnById(id: string, userId: string): Promise<Budget | null> {
    const doc = await BudgetModel.findOne({ _id: id, userId }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getByIdIncludingArchived(id: string): Promise<Budget | null> {
    const doc = await BudgetModel.findOne({ _id: id }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getAll(pagination: PaginationParams): Promise<PaginatedResult<Budget>> {
    return this.getAllByUserId("", pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: BudgetFilters,
  ): Promise<PaginatedResult<Budget>> {
    const { limit, offset, cursor } = pagination;
    const filter: Record<string, unknown> = { userId };
    if (!filters?.includeArchived) {
      filter.archivedAt = null;
    }
    if (cursor) {
      // Merge with an ids ($in) filter instead of clobbering it.
      filter._id =
        filter._id && typeof filter._id === "object"
          ? { ...(filter._id as Record<string, unknown>), $gt: cursor }
          : { $gt: cursor };
    }
    const [docs, total] = await Promise.all([
      BudgetModel.find(filter)
        .sort({ _id: 1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      BudgetModel.countDocuments(
        filters?.includeArchived ? { userId } : { userId, archivedAt: null },
      ),
    ]);
    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async create(budget: Partial<Budget>): Promise<Budget> {
    const id = budget.id ?? uuidv7();
    const doc = await BudgetModel.create({
      _id: id,
      ...this.toStorage(budget),
    });
    return this.toEntity(doc.toObject() as IBudgetDocument);
  }

  async update(
    id: string,
    budget: Partial<Budget>,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<Budget> {
    const doc = await BudgetModel.findOneAndUpdate(
      {
        _id: id,
        archivedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      this.toStorage(budget),
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Budget not found");
    }
    return this.toEntity(doc);
  }

  async delete(
    id: string,
    session?: TxSession,
    expectedUpdatedAt?: Date,
  ): Promise<void> {
    const doc = await BudgetModel.findOneAndUpdate(
      {
        _id: id,
        archivedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      { archivedAt: new Date() },
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Budget not found");
    }
  }

  async findOverlapping(
    userId: string,
    candidate: OverlapCandidate,
    excludeId?: string,
  ): Promise<Budget[]> {
    const { type, periodType, categoryIds } = candidate;
    const filter: Record<string, unknown> = {
      userId,
      type,
      archivedAt: null,
      periodType,
      // A global budget ([]) only conflicts with another global one; it
      // coexists with per-category budgets by design.
      categoryIds: categoryIds.length ? { $in: categoryIds } : { $size: 0 },
    };
    // Half-open windows [start, end): two CUSTOM budgets coexist unless they intersect.
    if (periodType === "CUSTOM") {
      filter.periodStartDate = { $lt: candidate.periodEndDate };
      filter.periodEndDate = { $gt: candidate.periodStartDate };
    }
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    const docs = await BudgetModel.find(filter).lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async restore(
    id: string,
    userId: string,
    expectedUpdatedAt?: Date,
  ): Promise<Budget | null> {
    const doc = await BudgetModel.findOneAndUpdate(
      {
        _id: id,
        userId,
        archivedAt: { $ne: null },
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      { archivedAt: null },
      { new: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async clearAmountOverride(
    id: string,
    userId: string,
    periodKey: string,
    expectedUpdatedAt?: Date,
  ): Promise<Budget | null> {
    const doc = await BudgetModel.findOneAndUpdate(
      {
        _id: id,
        userId,
        archivedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      { $unset: { [`amountOverrides.${periodKey}`]: "" } },
      { new: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async setAmountOverride(
    id: string,
    userId: string,
    periodKey: string,
    amount: number,
    expectedUpdatedAt?: Date,
  ): Promise<Budget | null> {
    const doc = await BudgetModel.findOneAndUpdate(
      {
        _id: id,
        userId,
        archivedAt: null,
        ...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
      },
      { $set: { [`amountOverrides.${periodKey}`]: toCents(amount) } },
      { new: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }
}
