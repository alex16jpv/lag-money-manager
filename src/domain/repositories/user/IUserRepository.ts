import { User } from "../../entities/User";
import { IRepository } from "../IRepository";

export interface IUserRepository extends IRepository<User> {
  getByEmail(email: string): Promise<User | null>;
  // Unlike getById, keeps the password hash (current-password verification).
  getByIdWithPassword(id: string): Promise<User | null>;
  // Atomic $inc: revokes every live refresh token of the user.
  bumpTokenVersion(id: string): Promise<void>;
  getDeletedByEmail(email: string): Promise<User | null>;
  // Clears the soft delete; the account keeps its financial history.
  reactivate(
    id: string,
    updates: Pick<User, "name" | "password"> & Partial<Pick<User, "timezone">>,
  ): Promise<User>;
}
