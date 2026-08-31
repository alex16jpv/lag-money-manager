import { v7 as uuidv7 } from "uuid";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { Account } from "../../entities/Account";
import {
  AccountMongoModel,
  IAccountDocument,
} from "../../models/mongoose/AccountMongoModel";
import { AccountFilters, IAccountRepository } from "./IAccountRepository";

export class AccountMongoRepository implements IAccountRepository {
  private toEntity(doc: IAccountDocument): Account {
    return new Account({
      id: doc._id,
      name: doc.name,
      type: doc.type,
      balance: doc.balance,
      userId: doc.userId,
    });
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

    const hasFilter = Object.keys(baseFilter).length > 0;
    const [docs, total] = await Promise.all([
      AccountMongoModel.find(filter)
        .sort({ _id: 1 })
        .skip(cursor ? 0 : offset)
        .limit(limit)
        .lean(),
      hasFilter
        ? AccountMongoModel.countDocuments(baseFilter)
        : AccountMongoModel.estimatedDocumentCount(),
    ]);

    return buildPaginatedResult(
      docs.map((doc) => this.toEntity(doc)),
      total,
      pagination,
    );
  }

  async getById(id: string): Promise<Account | null> {
    const doc = await AccountMongoModel.findById(id).lean();
    if (!doc) return null;
    return this.toEntity(doc);
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Account>> {
    return this.paginatedFind({}, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: AccountFilters,
  ): Promise<PaginatedResult<Account>> {
    const filter: Record<string, unknown> = { userId };
    if (filters?.ids?.length) {
      filter._id = { $in: filters.ids };
    }
    return this.paginatedFind(filter, pagination);
  }

  async create(account: Partial<Account>): Promise<Account> {
    const id = uuidv7();
    const doc = await AccountMongoModel.create({ _id: id, ...account });
    return this.toEntity(doc);
  }

  async update(id: string, account: Partial<Account>): Promise<Account> {
    const doc = await AccountMongoModel.findByIdAndUpdate(id, account, {
      new: true,
    }).lean();
    if (!doc) {
      throw new ApiError("NotFound", "Account not found");
    }
    return this.toEntity(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = await AccountMongoModel.findByIdAndDelete(id);
    if (!doc) {
      throw new ApiError("NotFound", "Account not found");
    }
  }
}
