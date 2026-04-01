import { IAccountRepository } from "../../domain/repositories/account/IAccountRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import { ENVIRONMENT } from "../../shared/constants";
import { ICategoryRepository } from "../../domain/repositories/category/ICategoryRepository";
import { ITransactionRepository } from "../../domain/repositories/transaction/ITransactionRepository";
import logger from "../../shared/logger";
import {
  dbType as seqDbType,
  registerRepositories as registerSeqRepositories,
} from "./providers/sequelizeProvider";
import {
  dbType as mongoDbType,
  registerRepositories as registerMongoRepositories,
} from "./providers/mongoProvider";

const dbType = ENVIRONMENT.DB_TYPE;

export const REPO_KEYS = {
  USER: "user",
  ACCOUNT: "account",
  CATEGORY: "category",
  TRANSACTION: "transaction",
} as const;

type DbProvider = (factory: RepositoryFactory) => void;

export class RepositoryFactory {
  private static providers = new Map<string, DbProvider>();

  private cache = new Map<string, unknown>();
  private creators = new Map<string, () => unknown>();

  static registerProvider(dbType: string, provider: DbProvider): void {
    RepositoryFactory.providers.set(dbType, provider);
  }

  constructor() {
    const provider = RepositoryFactory.providers.get(dbType);
    if (!provider) {
      throw new Error(`No database provider registered for DB_TYPE: ${dbType}`);
    }
    provider(this);
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

// Register providers
RepositoryFactory.registerProvider(seqDbType, registerSeqRepositories);
RepositoryFactory.registerProvider(mongoDbType, registerMongoRepositories);

const repositoryFactory = new RepositoryFactory();
export default repositoryFactory;
