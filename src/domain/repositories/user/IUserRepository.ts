import { User } from "../../entities/User";
import { IRepository } from "../IRepository";

export interface IUserRepository extends IRepository<User> {
  getByEmail(email: string): Promise<User | null>;
}
