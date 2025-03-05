import { ApiError } from "../../../shared/errors";
import { User } from "../../entities/User";
import { UserModel } from "../../models/UserModel";
import { IUserRepository } from "./IUserRepository";

export class UserSeqRepository implements IUserRepository {
  model: typeof UserModel;

  constructor(userModel: typeof UserModel) {
    this.model = userModel;
  }

  getById(id: User["id"]): Promise<User> {
    throw new ApiError("NotFound", "Method not implemented");
  }
  async getAll(): Promise<User[]> {
    const users = await this.model.findAll();
    return users.map((user) => {
      return new User({
        id: user.id,
        name: user.name,
      });
    });
  }
  create(user: User): Promise<void> {
    throw new ApiError("NotFound", "Method not implemented");
  }
  update(user: User): Promise<void> {
    throw new ApiError("NotFound", "Method not implemented");
  }
  delete(id: User["id"]): Promise<void> {
    throw new ApiError("NotFound", "Method not implemented");
  }
}
