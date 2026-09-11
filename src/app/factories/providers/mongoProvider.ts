import { connectMongo } from "../../../config/mongoConnection";
import { AccountRepository } from "../../../infrastructure/repositories/account/AccountRepository";
import { BudgetRepository } from "../../../infrastructure/repositories/budget/BudgetRepository";
import { CategoryRepository } from "../../../infrastructure/repositories/category/CategoryRepository";
import { IdempotencyRepository } from "../../../infrastructure/repositories/idempotency/IdempotencyRepository";
import { RefreshSessionRepository } from "../../../infrastructure/repositories/refreshSession/RefreshSessionRepository";
import { SyncOpRepository } from "../../../infrastructure/repositories/syncOp/SyncOpRepository";
import { TransactionRepository } from "../../../infrastructure/repositories/transaction/TransactionRepository";
import { UserRepository } from "../../../infrastructure/repositories/user/UserRepository";
import { DB_TYPES, IS_LAMBDA } from "../../../shared/constants";
import logger from "../../../shared/logger";

interface RegistryTarget {
  register(key: string, creator: () => unknown): void;
}

export const dbType = DB_TYPES.MONGO;

export function registerRepositories(factory: RegistryTarget): void {
  connectMongo().catch((err) => {
    logger.error({ err }, "Failed to connect to MongoDB");
    // In Lambda, exiting poisons the runtime, so only a long-lived server exits.
    if (!IS_LAMBDA) {
      process.exit(1);
    }
  });
  factory.register("user", () => new UserRepository());
  factory.register("account", () => new AccountRepository());
  factory.register("category", () => new CategoryRepository());
  factory.register("transaction", () => new TransactionRepository());
  factory.register("idempotency", () => new IdempotencyRepository());
  factory.register("budget", () => new BudgetRepository());
  factory.register("refreshSession", () => new RefreshSessionRepository());
  factory.register("syncOp", () => new SyncOpRepository());
}
