import { v7 as uuidv7 } from "uuid";

import { ApiError } from "../../../shared/errors";
import { fromCents, toCents } from "../../../shared/money";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { TxSession, withTransaction } from "../../../shared/unitOfWork";
import { Account } from "../../entities/Account";
import {
  AccountModel,
  IAccountDocument,
} from "../../models/AccountModel";
import { AccountFilters, IAccountRepository } from "./IAccountRepository";

export class AccountRepository implements IAccountRepository {
  private toEntity(doc: IAccountDocument): Account {
    return new Account({
      id: doc._id,
      name: doc.name,
      type: doc.type,
      balance: fromCents(doc.balance),
      color: doc.color as Account["color"],
      userId: doc.userId,
      isDefault: doc.isDefault,
      archivedAt: doc.deletedAt,
    });
  }

  private toStorage(account: Partial<Account>): Record<string, unknown> {
    const doc: Record<string, unknown> = { ...account };
    if (account.balance !== undefined) {
      doc.balance = toCents(account.balance);
    }
    return doc;
  }

  private async paginatedFind(
    baseFilter: Record<string, unknown>,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Account>> {
    const { limit, offset, cursor } = pagination;
    const filter = { ...baseFilter };
    if (cursor) {
      filter._id = { $gt: cursor };
    }

    const [docs, total] = await Promise.all([
      AccountModel.find(filter)
        .sort({ _id: 1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      AccountModel.countDocuments(baseFilter),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async getById(id: string, session?: TxSession): Promise<Account | null> {
    const doc = await AccountModel.findOne({ _id: id, deletedAt: null })
      .session(session ?? null)
      .lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Account>> {
    return this.paginatedFind({ deletedAt: null }, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: AccountFilters,
  ): Promise<PaginatedResult<Account>> {
    const filter: Record<string, unknown> = { userId };
    if (!filters?.includeArchived) {
      filter.deletedAt = null;
    }
    if (filters?.ids?.length) {
      filter._id = { $in: filters.ids };
    }
    return this.paginatedFind(filter, pagination);
  }

  async create(
    account: Partial<Account>,
    session?: TxSession,
  ): Promise<Account> {
    const id = account.id ?? uuidv7();
    const [doc] = await AccountModel.create(
      [{ _id: id, ...this.toStorage(account) }],
      { session: session ?? undefined },
    );
    return this.toEntity(doc.toObject());
  }

  async update(
    id: string,
    account: Partial<Account>,
    session?: TxSession,
  ): Promise<Account> {
    const doc = await AccountModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      this.toStorage(account),
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Account not found");
    }
    return this.toEntity(doc);
  }

  async incrementBalance(
    id: string,
    delta: number,
    session?: TxSession,
  ): Promise<Account | null> {
    const doc = await AccountModel.findOneAndUpdate(
      { _id: id },
      { $inc: { balance: toCents(delta) } },
      { new: true, session: session ?? undefined },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async delete(id: string, session?: TxSession): Promise<void> {
    const doc = await AccountModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Account not found");
    }
  }

  async restore(id: string, userId: string): Promise<Account | null> {
    const doc = await AccountModel.findOneAndUpdate(
      { _id: id, userId, deletedAt: { $ne: null } },
      { deletedAt: null },
      { new: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getDefaultByUserId(userId: string): Promise<Account | null> {
    const doc = await AccountModel.findOne({
      userId,
      isDefault: true,
      deletedAt: null,
    }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async setDefault(id: string, userId: string): Promise<Account | null> {
    return withTransaction(async (session) => {
      const target = await AccountModel.findOneAndUpdate(
        { _id: id, userId, deletedAt: null },
        { isDefault: true },
        { new: true, session },
      ).lean();
      if (!target) return null;
      await AccountModel.updateMany(
        { userId, _id: { $ne: id }, isDefault: true },
        { isDefault: false },
        { session },
      );
      return this.toEntity(target);
    });
  }

  async countByUserId(userId: string): Promise<number> {
    return AccountModel.countDocuments({ userId, deletedAt: null });
  }
}
