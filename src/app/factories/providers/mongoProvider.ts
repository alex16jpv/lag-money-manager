import { DB_TYPES } from "../../../shared/constants";
import { connectMongo } from "../../../config/mongoConnection";
import { UserMongoRepository } from "../../../domain/repositories/user/UserMongoRepository";
import { AccountMongoRepository } from "../../../domain/repositories/account/AccountMongoRepository";
import { CategoryMongoRepository } from "../../../domain/repositories/category/CategoryMongoRepository";
import { TransactionMongoRepository } from "../../../domain/repositories/transaction/TransactionMongoRepository";
import logger from "../../../shared/logger";

interface RegistryTarget {
  register(key: string, creator: () => unknown): void;
}

export const dbType = DB_TYPES.MONGO;

export function registerRepositories(factory: RegistryTarget): void {
  connectMongo().catch((err) => {
    logger.error({ err }, "Failed to connect to MongoDB");
    process.exit(1);
  });
  factory.register("user", () => new UserMongoRepository());
  factory.register("account", () => new AccountMongoRepository());
  factory.register("category", () => new CategoryMongoRepository());
  factory.register("transaction", () => new TransactionMongoRepository());
}
