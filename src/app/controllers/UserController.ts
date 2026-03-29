import { Request, Response } from "express";
import { UserService } from "../services/UserService";
import repositoryFactory from "../factories/RepositoryFactory";

const userService = new UserService(repositoryFactory.getUserRepository());

export class UserController {
  static getAllUsers = async (_req: Request, res: Response) => {
    const users = await userService.getAllUsers();
    res.status(200).json(users);
  };

  static getUserById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = await userService.getUserById(Number(id));
    res.status(200).json(user);
  };

  static createUser = async (req: Request, res: Response) => {
    const newUser = await userService.createUser(req.body);
    res.status(201).json(newUser);
  };

  static updateUser = async (req: Request, res: Response) => {
    const { id } = req.params;
    const updatedUser = await userService.updateUser(Number(id), req.body);
    res.status(200).json(updatedUser);
  };

  static deleteUser = async (req: Request, res: Response) => {
    const { id } = req.params;
    await userService.deleteUser(Number(id));
    res.status(204).send();
  };
}
