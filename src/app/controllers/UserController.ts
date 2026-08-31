import { Request, Response } from "express";

import repositoryFactory from "../factories/RepositoryFactory";
import { UserService } from "../services/UserService";

const userService = new UserService(
  repositoryFactory.getUserRepository(),
  repositoryFactory.getAccountRepository(),
);

export class UserController {
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
    res.status(200).json({ message: "User deleted successfully" });
  };
}
