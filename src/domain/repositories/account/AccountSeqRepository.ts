import { Op, WhereOptions } from "sequelize";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { Account } from "../../entities/Account";
import { AccountModel } from "../../models/sequelize/AccountModel";
import { AccountFilters, IAccountRepository } from "./IAccountRepository";

export class AccountSeqRepository implements IAccountRepository {
  private readonly model: typeof AccountModel;

  constructor() {
    this.model = AccountModel;
  }

  private async paginatedFindAll(
    baseWhere: WhereOptions,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Account>> {
    const { limit, offset, cursor } = pagination;
    const where: WhereOptions = cursor
      ? { ...baseWhere, id: { [Op.gt]: cursor } }
      : baseWhere;

    const { rows, count } = await this.model.findAndCountAll({
      where,
      order: [["id", "ASC"]],
      limit,
      offset: cursor ? 0 : offset,
    });
    const total = cursor ? await this.model.count({ where: baseWhere }) : count;

    const data = rows.map((result) => new Account(result.toJSON()));
    return buildPaginatedResult(data, total, pagination);
  }

  async getById(id: Account["id"]): Promise<Account | null> {
    const result = await this.model.findByPk(id);
    if (!result) {
      return null;
    }
    return new Account(result.toJSON());
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Account>> {
    return this.paginatedFindAll({}, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
    filters?: AccountFilters,
  ): Promise<PaginatedResult<Account>> {
    const where: WhereOptions = { userId };
    if (filters?.ids?.length) {
      where.id = { [Op.in]: filters.ids };
    }
    return this.paginatedFindAll(where, pagination);
  }

  async create(account: Partial<Account>): Promise<Account> {
    const result = await this.model.create(account);
    return new Account(result.toJSON());
  }

  async update(id: Account["id"], account: Partial<Account>): Promise<Account> {
    const accountToUpdate = await this.model.findByPk(id);
    if (!accountToUpdate) {
      throw new ApiError("NotFound", "Account not found");
    }
    await accountToUpdate.update(account);
    await accountToUpdate.reload();
    return new Account(accountToUpdate.toJSON());
  }

  async delete(id: Account["id"]): Promise<void> {
    const account = await this.model.findByPk(id);
    if (!account) {
      throw new ApiError("NotFound", "Account not found");
    }
    await account.destroy();
  }
}
