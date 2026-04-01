import { DB_TYPES } from "../../../shared/constants";
import { loadSequelizeModels } from "../../../domain/models/sequelize/index";
import { UserSeqRepository } from "../../../domain/repositories/user/UserSeqRepository";
import { AccountSeqRepository } from "../../../domain/repositories/account/AccountSeqRepository";
import { CategorySeqRepository } from "../../../domain/repositories/category/CategorySeqRepository";
import { TransactionSeqRepository } from "../../../domain/repositories/transaction/TransactionSeqRepository";

interface RegistryTarget {
  register(key: string, creator: () => unknown): void;
}

export const dbType = DB_TYPES.SEQ;

export function registerRepositories(factory: RegistryTarget): void {
  loadSequelizeModels();
  factory.register("user", () => new UserSeqRepository());
  factory.register("account", () => new AccountSeqRepository());
  factory.register("category", () => new CategorySeqRepository());
  factory.register("transaction", () => new TransactionSeqRepository());
}
