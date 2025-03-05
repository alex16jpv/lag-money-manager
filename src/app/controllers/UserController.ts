import { NextFunction, Request, Response } from "express";
import { UserService } from "../services/UserService";
import { User } from "../../domain/entities/User";
import repositoryFactory from "../factories/RepositoryFactory";

const userService = new UserService(repositoryFactory.getUserRepository());

export class UserController {
  static async getAllUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const users = await userService.getAllUsers();
      res.status(200).json(users);
    } catch (error) {
      next(error);
    }
  }

  static async getUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = await userService.getUserById(Number(id));
      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  }

  static async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.body as User;
      const newUser = await userService.createUser(user);
      res.status(201).json(newUser);
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.body as User;

      const updatedUser = await userService.updateUser(Number(id), user);
      res.status(200).json(updatedUser);
    } catch (error) {
      next(error);
    }
  }

  static async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await userService.deleteUser(Number(id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
