import { v7 as uuidv7 } from "uuid";

import { Budget } from "../../../domain/entities/Budget";
import { BudgetFilters, IBudgetRepository } from "../../../domain/repositories/budget/IBudgetRepository";
import { BudgetPeriodType, BudgetType } from "../../../shared/constants";
import { ApiError } from "../../../shared/errors";
import { fromCents, toCents } from "../../../shared/money";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
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
      amount: fromCents(doc.amount),
      amountOverrides: overrides,
      periodType: doc.periodType,
      periodStartDate: doc.periodStartDate,
      periodEndDate: doc.periodEndDate,
      effectiveFrom: doc.effectiveFrom ?? null,
      note: doc.note ?? null,
      userId: doc.userId,
      archivedAt: doc.deletedAt,
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
    const doc = await BudgetModel.findOne({ _id: id, deletedAt: null }).lean();
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
      filter.deletedAt = null;
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
        filters?.includeArchived ? { userId } : { userId, deletedAt: null },
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
    const doc = await BudgetModel.create({ _id: id, ...this.toStorage(budget) });
    return this.toEntity(doc.toObject() as IBudgetDocument);
  }

  async update(id: string, budget: Partial<Budget>): Promise<Budget> {
    const doc = await BudgetModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      this.toStorage(budget),
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Budget not found");
    }
    return this.toEntity(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await BudgetModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Budget not found");
    }
  }

  async findOverlapping(
    userId: string,
    type: BudgetType,
    periodType: BudgetPeriodType,
    categoryIds: string[],
    excludeId?: string,
  ): Promise<Budget[]> {
    const filter: Record<string, unknown> = {
      userId,
      type,
      deletedAt: null,
      periodType,
      // A global budget ([]) only conflicts with another global one; it
      // coexists with per-category budgets by design.
      categoryIds: categoryIds.length
        ? { $in: categoryIds }
        : { $size: 0 },
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    const docs = await BudgetModel.find(filter).lean();
    return docs.map((doc) => this.toEntity(doc));
  }

  async clearAmountOverride(
    id: string,
    userId: string,
    periodKey: string,
  ): Promise<Budget | null> {
    const doc = await BudgetModel.findOneAndUpdate(
      { _id: id, userId, deletedAt: null },
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
  ): Promise<Budget | null> {
    const doc = await BudgetModel.findOneAndUpdate(
      { _id: id, userId, deletedAt: null },
      { $set: { [`amountOverrides.${periodKey}`]: toCents(amount) } },
      { new: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }
}
