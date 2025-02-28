import { User } from "../../entities/User";

export interface IUserRepository {
  getById(id: User["id"]): Promise<User>;
  getAll(): Promise<User[]>;
  create(user: User): Promise<void>;
  update(user: User): Promise<void>;
  delete(id: User["id"]): Promise<void>;
}
