import { Op, WhereOptions } from "sequelize";
import {
  buildPaginatedResult,
  PaginatedResult,
  PaginationParams,
} from "../../../shared/pagination";
import { ApiError } from "../../../shared/errors";
import { User } from "../../entities/User";
import { UserModel } from "../../models/sequelize/UserModel";
import { IUserRepository } from "./IUserRepository";

export class UserSeqRepository implements IUserRepository {
  model: typeof UserModel;

  constructor() {
    this.model = UserModel;
  }

  async getById(id: User["id"]): Promise<User | null> {
    const user = (await this.model.findByPk(id))?.toJSON();
    if (!user) {
      return null;
    }
    return new User(user);
  }

  async getByEmail(email: string): Promise<User | null> {
    const user = (await this.model.findOne({ where: { email } }))?.toJSON();
    if (!user) {
      return null;
    }
    return new User(user);
  }

  async getAll(pagination: PaginationParams): Promise<PaginatedResult<User>> {
    const { limit, offset, cursor } = pagination;
    const where: WhereOptions = cursor ? { id: { [Op.gt]: cursor } } : {};

    const [{ rows }, total] = await Promise.all([
      this.model.findAndCountAll({
        where,
        order: [["id", "ASC"]],
        limit,
        offset: cursor ? 0 : offset,
      }),
      this.model.count(),
    ]);

    const data = rows.map((user) => new User(user));
    return buildPaginatedResult(data, total, pagination);
  }

  async create(user: Partial<User>): Promise<User> {
    const result = await this.model.create(user);
    return new User(result.toJSON());
  }

  async update(id: User["id"], user: Partial<User>): Promise<User> {
    const userToUpdate = await this.model.findByPk(id);
    if (!userToUpdate) {
      throw new ApiError("NotFound", "User not found");
    }
    await userToUpdate.update(user);
    await userToUpdate.reload();
    return new User(userToUpdate.toJSON());
  }

  async delete(id: User["id"]): Promise<void> {
    const user = await this.model.findByPk(id);
    if (!user) {
      throw new ApiError("NotFound", "User not found");
    }
    await user.destroy();
  }
}
