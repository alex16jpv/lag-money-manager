import { User } from "../../entities/User";

export interface IUserRepository {
  getById(id: User["id"]): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  getAll(): Promise<User[]>;
  create(user: User): Promise<User>;
  update(id: User["id"], user: Partial<User>): Promise<User>;
  delete(id: User["id"]): Promise<void>;
}
