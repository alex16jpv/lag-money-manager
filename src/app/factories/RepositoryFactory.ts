import { AccountSeqRepository } from "../../domain/repositories/account/AccountSeqRepository";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { UserSeqRepository } from "../../domain/repositories/user/UserSeqRepository";
import { DB_TYPES } from "../../shared/constants";
import { ENVIRONMENT } from "../../shared/constants";
import { loadSequelizeModels } from "../../domain/models/index";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { CategorySeqRepository } from "../../domain/repositories/category/CategorySeqRepository";

const dbType = ENVIRONMENT.DB_TYPE;

export class RepositoryFactory {
  userRepository: IUserRepository | null = null;
  accountRepository: IAccountRepository | null = null;
  categoryRepository: ICategoryRepository | null = null;

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

  getCategoryRepository(): ICategoryRepository {
    if (this.categoryRepository) {
      console.log("USING CACHED CATEGORY REPOSITORY");
      return this.categoryRepository;
    }

    console.log("GETTING CATEGORY REPOSITORY");
    if (dbType === DB_TYPES.SEQ) {
      this.categoryRepository = new CategorySeqRepository();
      return this.categoryRepository;
    } else if (dbType === DB_TYPES.MONGO) {
      // add mongo category repository...
    }

    throw new Error("Invalid database type");
  }
}

const repositoryFactory = new RepositoryFactory();
export default repositoryFactory;
