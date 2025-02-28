import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { UserSeqRepository } from "../../domain/repositories/user/UserSeqRepository";
import { DB_TYPES } from "../../shared/constants";

const dbType = DB_TYPES.SEQ; // or "MONGO" or "LOCAL_STORAGE" | process.env.DB_TYPE

export class RepositoryFactory {
  static getUserRepository(): IUserRepository {
    if (dbType === DB_TYPES.SEQ) {
      return new UserSeqRepository();
    }

    return new UserSeqRepository();
  }
}
