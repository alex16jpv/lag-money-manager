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

const REPO_KEYS = {
  USER: "user",
  ACCOUNT: "account",
  CATEGORY: "category",
  TRANSACTION: "transaction",
} as const;

export class RepositoryFactory {
  private cache = new Map<string, unknown>();
  private creators = new Map<string, () => unknown>();

  constructor() {
    if (dbType === DB_TYPES.SEQ) {
      loadSequelizeModels();
      this.register(REPO_KEYS.USER, () => new UserSeqRepository());
      this.register(REPO_KEYS.ACCOUNT, () => new AccountSeqRepository());
      this.register(REPO_KEYS.CATEGORY, () => new CategorySeqRepository());
      this.register(
        REPO_KEYS.TRANSACTION,
        () => new TransactionSeqRepository(),
      );
    }
  }

  register(key: string, creator: () => unknown): void {
    this.creators.set(key, creator);
    this.cache.delete(key);
  }

  private getRepository<T>(key: string): T {
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }
    const creator = this.creators.get(key);
    if (!creator) {
      throw new Error(`No repository registered for key: ${key}`);
    }
    const repo = creator() as T;
    this.cache.set(key, repo);
    logger.debug(`Initialized ${key} repository`);
    return repo;
  }

  getUserRepository(): IUserRepository {
    return this.getRepository<IUserRepository>(REPO_KEYS.USER);
  }

  getAccountRepository(): IAccountRepository {
    return this.getRepository<IAccountRepository>(REPO_KEYS.ACCOUNT);
  }

  getCategoryRepository(): ICategoryRepository {
    return this.getRepository<ICategoryRepository>(REPO_KEYS.CATEGORY);
  }

  getTransactionRepository(): ITransactionRepository {
    return this.getRepository<ITransactionRepository>(REPO_KEYS.TRANSACTION);
  }
}

const repositoryFactory = new RepositoryFactory();
export default repositoryFactory;
