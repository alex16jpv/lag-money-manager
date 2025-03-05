import { User } from "../../entities/User";

export interface IUserRepository {
  getById(id: User["id"]): Promise<User>;
  getAll(): Promise<User[]>;
  create(user: User): Promise<User>;
  update(id: User["id"], user: User): Promise<User>;
  delete(id: User["id"]): Promise<void>;
}
