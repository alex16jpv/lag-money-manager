import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ApiError } from "../../shared/errors";

export class UserService {
  constructor(private repo: IUserRepository) {}

  async getAllUsers(): Promise<User[]> {
    return await this.repo.getAll();
  }

  async getUserById(id: User["id"]): Promise<User> {
    return await this.repo.getById(id);
  }

  async createUser(user: User): Promise<User> {
    const userToCreate = new User(user);
    userToCreate.validate();

    return await this.repo.create(userToCreate);
  }

  async updateUser(id: User["id"], user: User): Promise<User> {
    if (user?.id && id !== user.id) {
      throw new ApiError("BadRequest", "User id does not match");
    }

    return await this.repo.update(id, user);
  }

  async deleteUser(id: User["id"]): Promise<void> {
    return await this.repo.delete(id);
  }
}
