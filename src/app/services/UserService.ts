import bcryptjs from "bcryptjs";
import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../shared/errors";

export class UserService {
  constructor(private repo: IUserRepository) {}

  async getAllUsers(): Promise<User[]> {
    return await this.repo.getAll();
  }

  async getUserById(id: User["id"]): Promise<User> {
    const user = await this.repo.getById(id);
    if (!user) {
      throw new ApiError("NotFound", "User not found");
    }
    return user;
  }

  async createUser(user: User): Promise<User> {
    const userToCreate = new User(user);
    userToCreate.validate();

    if (userToCreate.password) {
      userToCreate.password = await bcryptjs.hash(userToCreate.password, 12);
    }

    return await this.repo.create(userToCreate);
  }

  async updateUser(id: User["id"], user: Partial<User>): Promise<User> {
    if (user?.id && id !== user.id) {
      throw new ApiError("BadRequest", "User id does not match");
    }

    if (user.password) {
      user.password = await bcryptjs.hash(user.password, 12);
    }

    return await this.repo.update(id, user);
  }

  async deleteUser(id: User["id"]): Promise<void> {
    return await this.repo.delete(id);
  }
}
