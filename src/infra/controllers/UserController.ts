import { UserService } from "../../application/services/UserService";
import { User } from "../../domain/entities/User";
import { RepositoryFactory } from "../factories/RepositoryFactory";

const userService = new UserService(RepositoryFactory.getUserRepository());

export class UserController {
  static getAllUsers() {
    return userService.getAllUsers();
  }

  static getUserById(id: User["id"]) {
    return userService.getUserById(id);
  }

  static createUser(user: User) {
    return userService.createUser(user);
  }

  static updateUser(user: User) {
    return userService.updateUser(user);
  }

  static deleteUser(id: User["id"]) {
    return userService.deleteUser(id);
  }
}
