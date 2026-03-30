import { Op, WhereOptions } from "sequelize";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { Account } from "../../entities/Account";
import { AccountModel } from "../../models/sequelize/AccountModel";
import { IAccountRepository } from "./IAccountRepository";

export class AccountSeqRepository implements IAccountRepository {
  model: typeof AccountModel;

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

    const [{ rows }, total] = await Promise.all([
      this.model.findAndCountAll({
        where,
        order: [["id", "ASC"]],
        limit,
        offset: cursor ? 0 : offset,
      }),
      this.model.count({ where: baseWhere }),
    ]);

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
  ): Promise<PaginatedResult<Account>> {
    return this.paginatedFindAll({ userId }, pagination);
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
