import sequelize from "../../config/sequelizeConnection";
import { userModelInit } from "../../domain/models/UserModel";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { UserSeqRepository } from "../../domain/repositories/user/UserSeqRepository";
import { DB_TYPES } from "../../shared/constants";
import { ENVIRONMENT } from "../../shared/constants";

const dbType = ENVIRONMENT.DB_TYPE;

export class RepositoryFactory {
  static getUserRepository(): IUserRepository {
    console.log("GETTING USER REPOSITORY");

    if (dbType === DB_TYPES.SEQ) {
      const userModel = userModelInit(sequelize);
      return new UserSeqRepository(userModel);
    } else if (dbType === DB_TYPES.MONGO) {
      // add mongo repository...
    }

    throw new Error("Invalid database type");
  }
}
