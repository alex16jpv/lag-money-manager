import { connectMongo } from "../../../config/mongoConnection";
import { AccountRepository } from "../../../domain/repositories/account/AccountRepository";
import { CategoryRepository } from "../../../domain/repositories/category/CategoryRepository";
import { TransactionRepository } from "../../../domain/repositories/transaction/TransactionRepository";
import { UserRepository } from "../../../domain/repositories/user/UserRepository";
import { DB_TYPES, IS_LAMBDA } from "../../../shared/constants";
import logger from "../../../shared/logger";

interface RegistryTarget {
  register(key: string, creator: () => unknown): void;
}

export const dbType = DB_TYPES.MONGO;

export function registerRepositories(factory: RegistryTarget): void {
  connectMongo().catch((err) => {
    logger.error({ err }, "Failed to connect to MongoDB");
    // Fail fast in a long-lived server so the orchestrator restarts it.
    // In Lambda, exiting poisons the runtime (later invocations get an
    // opaque 502); requests retry the connection instead.
    if (!IS_LAMBDA) {
      process.exit(1);
    }
  });
  factory.register("user", () => new UserRepository());
  factory.register("account", () => new AccountRepository());
  factory.register("category", () => new CategoryRepository());
  factory.register("transaction", () => new TransactionRepository());
}
