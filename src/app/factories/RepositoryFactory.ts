import sequelize from "../../config/sequelizeConnection";
import { userModelInit } from "../../domain/models/UserModel";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { UserSeqRepository } from "../../domain/repositories/user/UserSeqRepository";
import { DB_TYPES } from "../../shared/constants";
import { ENVIRONMENT } from "../../shared/constants";

const dbType = ENVIRONMENT.DB_TYPE;

export class RepositoryFactory {
  userRepository: IUserRepository | null = null;

  getUserRepository(): IUserRepository {
    if (this.userRepository) {
      console.log("USING CACHED USER REPOSITORY");
      return this.userRepository;
    }

    console.log("GETTING USER REPOSITORY");
    if (dbType === DB_TYPES.SEQ) {
      const userModel = userModelInit(sequelize);
      this.userRepository = new UserSeqRepository(userModel);
      return this.userRepository;
    } else if (dbType === DB_TYPES.MONGO) {
      // add mongo repository...
    }

    throw new Error("Invalid database type");
  }
}

const repositoryFactory = new RepositoryFactory();
export default repositoryFactory;
