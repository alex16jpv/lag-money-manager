import { v7 as uuidv7 } from "uuid";

import { Account } from "../../../domain/entities/Account";
import { AccountFilters, IAccountRepository } from "../../../domain/repositories/account/IAccountRepository";
import { ApiError } from "../../../shared/errors";
import { fromCents, toCents } from "../../../shared/money";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { TxSession, withTransaction } from "../../../shared/unitOfWork";
import {
  AccountModel,
  IAccountDocument,
} from "../../models/AccountModel";

export class AccountRepository implements IAccountRepository {
  private toEntity(doc: IAccountDocument): Account {
    return new Account({
      id: doc._id,
      name: doc.name,
      type: doc.type,
      balance: fromCents(doc.balance),
      openingBalance: fromCents(doc.openingBalance),
      color: doc.color as Account["color"],
      userId: doc.userId,
      isDefault: doc.isDefault,
      currency: doc.currency,
      archivedAt: doc.archivedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  private toStorage(account: Partial<Account>): Record<string, unknown> {
    const doc: Record<string, unknown> = { ...account };
    if (account.balance !== undefined) {
      doc.balance = toCents(account.balance);
    }
    if (account.openingBalance !== undefined) {
      doc.openingBalance = toCents(account.openingBalance);
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
      // Merge with an ids ($in) filter instead of clobbering it.
      filter._id =
        filter._id && typeof filter._id === "object"
          ? { ...(filter._id as Record<string, unknown>), $gt: cursor }
          : { $gt: cursor };
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
    const doc = await AccountModel.findOne({ _id: id, archivedAt: null })
      .session(session ?? null)
      .lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getByIdIncludingArchived(id: string): Promise<Account | null> {
    const doc = await AccountModel.findById(id).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Account>> {
    return this.paginatedFind({ archivedAt: null }, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: AccountFilters,
  ): Promise<PaginatedResult<Account>> {
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
      { _id: id, archivedAt: null },
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
  ): Promise<boolean> {
    // No archivedAt filter: reversals must reach archived accounts too.
    const res = await AccountModel.updateOne(
      { _id: id },
      { $inc: { balance: toCents(delta) } },
      { session: session ?? undefined },
    );
    return res.matchedCount === 1;
  }

  async delete(id: string, session?: TxSession): Promise<void> {
    const doc = await AccountModel.findOneAndUpdate(
      { _id: id, archivedAt: null },
      { archivedAt: new Date() },
      { new: true, session: session ?? undefined },
    ).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Account not found");
    }
  }

  async archiveNonDefault(id: string, userId: string): Promise<boolean> {
    const doc = await AccountModel.findOneAndUpdate(
      { _id: id, userId, archivedAt: null, isDefault: false },
      { archivedAt: new Date() },
      { new: true },
    ).lean();
    return doc !== null;
  }

  async restore(id: string, userId: string): Promise<Account | null> {
    // Never restore as default: another account may have taken the flag.
    const doc = await AccountModel.findOneAndUpdate(
      { _id: id, userId, archivedAt: { $ne: null } },
      { archivedAt: null, isDefault: false },
      { new: true },
    ).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async getDefaultByUserId(userId: string): Promise<Account | null> {
    const doc = await AccountModel.findOne({
      userId,
      isDefault: true,
      archivedAt: null,
    }).lean();
    return doc ? this.toEntity(doc) : null;
  }

  async setDefault(id: string, userId: string): Promise<Account | null> {
    return withTransaction(async (session) => {
      const target = await AccountModel.findOneAndUpdate(
        { _id: id, userId, archivedAt: null },
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
    return AccountModel.countDocuments({ userId, archivedAt: null });
  }
}
