import { NextFunction, Request, Response } from "express";
import { UserService } from "../services/UserService";
import { User } from "../../domain/entities/User";
import { RepositoryFactory } from "../factories/RepositoryFactory";

const userService = new UserService(RepositoryFactory.getUserRepository());

export class UserController {
  static async getAllUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const users = await userService.getAllUsers();
      res.status(200).json(users);
    } catch (error) {
      next(error);
    }
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
