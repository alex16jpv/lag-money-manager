import { Op, WhereOptions } from "sequelize";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { Transaction } from "../../entities/Transaction";
import { TransactionModel } from "../../models/sequelize/TransactionModel";
import { ITransactionRepository } from "./ITransactionRepository";

export class TransactionSeqRepository implements ITransactionRepository {
  private readonly model: typeof TransactionModel;

  constructor() {
    this.model = TransactionModel;
  }

  private async paginatedFindAll(
    baseWhere: WhereOptions,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>> {
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

    const data = rows.map((result) => new Transaction(result.toJSON()));
    return buildPaginatedResult(data, total, pagination);
  }

  async getById(id: string): Promise<Transaction | null> {
    const result = await this.model.findByPk(id);
    if (!result) {
      return null;
    }
    return new Transaction(result.toJSON());
  }

  async getAll(
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>> {
    return this.paginatedFindAll({}, pagination);
  }

  async getAllByUserId(
    userId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Transaction>> {
    return this.paginatedFindAll({ userId }, pagination);
  }

  async create(transaction: Partial<Transaction>): Promise<Transaction> {
    const result = await this.model.create(transaction);
    return new Transaction(result.toJSON());
  }

  async update(
    id: string,
    transaction: Partial<Transaction>,
  ): Promise<Transaction> {
    const existing = await this.model.findByPk(id);
    if (!existing) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    await existing.update(transaction);
    await existing.reload();
    return new Transaction(existing.toJSON());
  }

  async delete(id: string): Promise<void> {
    const existing = await this.model.findByPk(id);
    if (!existing) {
      throw new ApiError("NotFound", "Transaction not found");
    }
    await existing.destroy();
  }
}
