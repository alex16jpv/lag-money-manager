import { AccountSeqRepository } from "../../domain/repositories/account/AccountSeqRepository";
import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { UserSeqRepository } from "../../domain/repositories/user/UserSeqRepository";
import { DB_TYPES } from "../../shared/constants";
import { ENVIRONMENT } from "../../shared/constants";
import { loadSequelizeModels } from "../../domain/models/index";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { CategorySeqRepository } from "../../domain/repositories/category/CategorySeqRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import { TransactionSeqRepository } from "../../domain/repositories/transaction/TransactionSeqRepository";
import logger from "../../shared/logger";

const dbType = ENVIRONMENT.DB_TYPE;

export class RepositoryFactory {
  userRepository: IUserRepository | null = null;
  accountRepository: IAccountRepository | null = null;
  categoryRepository: ICategoryRepository | null = null;
  transactionRepository: ITransactionRepository | null = null;

  constructor() {
    if (dbType === DB_TYPES.SEQ) {
      loadSequelizeModels();
    }
  }

  getUserRepository(): IUserRepository {
    if (this.userRepository) {
      return this.userRepository;
    }

    logger.debug("Initializing user repository");
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
      return this.accountRepository;
    }

    logger.debug("Initializing account repository");
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
      return this.categoryRepository;
    }

    logger.debug("Initializing category repository");
    if (dbType === DB_TYPES.SEQ) {
      this.categoryRepository = new CategorySeqRepository();
      return this.categoryRepository;
    } else if (dbType === DB_TYPES.MONGO) {
      // add mongo category repository...
    }

    throw new Error("Invalid database type");
  }

  getTransactionRepository(): ITransactionRepository {
    if (this.transactionRepository) {
      return this.transactionRepository;
    }

    logger.debug("Initializing transaction repository");
    if (dbType === DB_TYPES.SEQ) {
      this.transactionRepository = new TransactionSeqRepository();
      return this.transactionRepository;
    } else if (dbType === DB_TYPES.MONGO) {
      // add mongo transaction repository...
    }

    throw new Error("Invalid database type");
  }
}

const repositoryFactory = new RepositoryFactory();
export default repositoryFactory;
