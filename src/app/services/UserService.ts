import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";

export class UserService {
  constructor(private repo: IUserRepository) {}

  async getAllUsers() {
    return this.repo.getAll();
  }

  async getUserById(id: User["id"]) {
    return this.repo.getById(id);
  }

  async createUser(user: User) {
    return this.repo.create(user);
  }

  async updateUser(id: User["id"], user: User) {
    return this.repo.update(id, user);
  }

  async deleteUser(id: User["id"]) {
    return this.repo.delete(id);
  }
}
