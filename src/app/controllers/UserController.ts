import { Request, Response } from "express";
import { UserService } from "../services/UserService";
import repositoryFactory from "../factories/RepositoryFactory";
import { extractPagination } from "../../shared/pagination";

const userService = new UserService(repositoryFactory.getUserRepository());

export class UserController {
  static getAllUsers = async (req: Request, res: Response) => {
    const result = await userService.getAllUsers(extractPagination(req));
    res.status(200).json(result);
  };

  static getUserById = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const user = await userService.getUserById(id, userId);
    res.status(200).json(user);
  };

  static updateUser = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    const updatedUser = await userService.updateUser(id, req.body, userId);
    res.status(200).json(updatedUser);
  };

  static deleteUser = async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const id = req.params.id as string;
    await userService.deleteUser(id, userId);
    res.status(200).json({ message: 'User deleted successfully' });
  };
}
