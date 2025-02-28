import { User } from "../../entities/User";
import { IUserRepository } from "./IUserRepository";

export class UserSeqRepository implements IUserRepository {
  getById(id: User["id"]): Promise<User> {
    throw new Error("Method not implemented.");
  }
  getAll(): Promise<User[]> {
    throw new Error("Method not implemented.");
  }
  create(user: User): Promise<void> {
    throw new Error("Method not implemented.");
  }
  update(user: User): Promise<void> {
    throw new Error("Method not implemented.");
  }
  delete(id: User["id"]): Promise<void> {
    throw new Error("Method not implemented.");
  }
}
