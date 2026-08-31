import { User } from "../../entities/User";
import { IRepository } from "../IRepository";

export interface IUserRepository extends IRepository<User> {
  getByEmail(email: string): Promise<User | null>;
  getDeletedByEmail(email: string): Promise<User | null>;
  // Clears the soft delete; the account keeps its financial history.
  reactivate(id: string, updates: Partial<User>): Promise<User>;
}
