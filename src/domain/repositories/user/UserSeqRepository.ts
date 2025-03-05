import { ApiError } from "../../../shared/errors";
import { User } from "../../entities/User";
import { UserModel } from "../../models/UserModel";
import { IUserRepository } from "./IUserRepository";

export class UserSeqRepository implements IUserRepository {
  model: typeof UserModel;

  constructor(userModel: typeof UserModel) {
    this.model = userModel;
  }

  async getById(id: User["id"]): Promise<User> {
    const user = (await this.model.findByPk(id))?.toJSON();

    if (!user) {
      throw new ApiError("NotFound", "User not found");
    }
    return new User(user);
  }

  async getAll(): Promise<User[]> {
    const users = await this.model.findAll();
    return users?.map((user) => {
      return new User(user);
    });
  }

  async create(user: Partial<User>): Promise<User> {
    const result = await this.model.create(user);
    return result.toJSON();
  }

  async update(id: User["id"], user: Partial<User>): Promise<User> {
    const userToUpdate = await this.model.findByPk(id);
    if (!userToUpdate) {
      throw new ApiError("NotFound", "User not found");
    }
    await userToUpdate.update(user);
    await userToUpdate.reload();
    return userToUpdate.toJSON();
  }

  async delete(id: User["id"]): Promise<void> {
    const user = await this.model.findByPk(id);
    if (!user) {
      throw new ApiError("NotFound", "User not found");
    }
    await user.destroy();
  }
}
