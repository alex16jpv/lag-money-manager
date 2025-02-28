import { User } from "../../domain/entities/User";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";

export class UserService {
  constructor(private repo: IUserRepository) {}

  getAllUsers() {
    return this.repo.getAll();
  }

  getUserById(id: User["id"]) {
    return this.repo.getById(id);
  }

  createUser(user: User) {
    return this.repo.create(user);
  }

  updateUser(user: User) {
    return this.repo.update(user);
  }

  deleteUser(id: User["id"]) {
    return this.repo.delete(id);
  }
}
