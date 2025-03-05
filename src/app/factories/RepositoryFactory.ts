import { AccountSeqRepository } from "../../domain/repositories/account/AccountSeqRepository";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { UserSeqRepository } from "../../domain/repositories/user/UserSeqRepository";
import { DB_TYPES } from "../../shared/constants";
import { ENVIRONMENT } from "../../shared/constants";
import { loadSequelizeModels } from "../../domain/models/index";

const dbType = ENVIRONMENT.DB_TYPE;

export class RepositoryFactory {
  userRepository: IUserRepository | null = null;
  accountRepository: IAccountRepository | null = null;

  constructor() {
    if (dbType === DB_TYPES.SEQ) {
      loadSequelizeModels();
    }
  }

  getUserRepository(): IUserRepository {
    if (this.userRepository) {
      console.log("USING CACHED USER REPOSITORY");
      return this.userRepository;
    }

    console.log("GETTING USER REPOSITORY");
    if (dbType === DB_TYPES.SEQ) {
      this.userRepository = new UserSeqRepository();
      return this.userRepository;
    } else if (dbType === DB_TYPES.MONGO) {
      // add mongo repository...
    }

    throw new Error("Invalid database type");
  }

  getAccountRepository(): IAccountRepository {
    if (this.accountRepository) {
      console.log("USING CACHED ACCOUNT REPOSITORY");
      return this.accountRepository;
    }

    console.log("GETTING ACCOUNT REPOSITORY");
    if (dbType === DB_TYPES.SEQ) {
      this.accountRepository = new AccountSeqRepository();
      return this.accountRepository;
    } else if (dbType === DB_TYPES.MONGO) {
      // add mongo account repository...
    }

    throw new Error("Invalid database type");
  }
}

const repositoryFactory = new RepositoryFactory();
export default repositoryFactory;
